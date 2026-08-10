import type { Program } from '../perception';
import { length, normalize, scale } from '../vec2';
import { PHYSICS } from '../world';
import { closest, isLocalMax } from './util';

// 資源は拠点からほぼ真東にある、というこのシナリオ固有のレイアウト知識を
// 定数として埋め込んでいる（relay.ts/ladder.tsと同じ考え方）。
const EXPLORE_DIR = { x: 1, y: 0 };
const RETURN_DIR = { x: -1, y: 0 };
// maxLineLengthのこの割合まで離れたら建設を試み始める。0.75の理由はladder.ts
// 参照（dead reckoningの系統的なズレ＋リーダー選出の据え置きで立ち往生する
// ケースがあったため、安全マージンを広げてある）。
const BUILD_MARGIN = 0.75;
const INTENT_SLOT = 2; // memory[2]: 「今建設したい」という意思表示（1=あり/0=なし、ladder.tsと同じ）

/**
 * ladder.tsの「アンカーから離れたら補給所を建設しつつ外側へ進む」と、gather.tsの
 * 「資源を見つけて拠点まで運ぶ」を1つのプログラムに統合した出発点の実装。
 *
 * memory[0..1]には直前の既知アンカー(拠点 or 補給所)からの推定変位をdead
 * reckoningで積んでおく（ladder.tsと同じ慣習）。空荷のとき、この推定距離が
 * maxLineLengthに近づいたら新しい補給所を建設する判断材料に使う。資源が
 * 見えているかどうかに関わらず判定するため、資源を追いかけて経路がEXPLORE_DIR
 * から逸れても、進んだ先で建設される——結果としてラダーが資源の方向へ伸びていく。
 *
 * 復路(cargo>0)は特定のアンカーの`relPos`を目がけるのではなく、単純に西
 * （拠点方向）へ定方向で進む。当初は「視界内で自分より拠点側にあるアンカーへ
 * 向かう」実装を試したが、直前に自分で建てた補給所のほぼ真上にいる状況では
 * 視界内で唯一見えるアンカーがその補給所自身になり、1tickごとにオーバーシュート
 * して西→東→西...と`relPos.x`の符号が反転し続け、その場で永久に往復振動して
 * 前進しなくなる不具合があった（ヘッドレス検証で発見）。補給所への立ち寄り
 * （燃料回復）はsimulate.ts側の受動的な近接判定に任せれば十分なので、復路の
 * 進行方向を特定のアンカーに依存させる必要はない。搬入(drop)も同じ理由で
 * 「西へ進む途中でたまたまinteractRadius内に入ったアンカー（拠点でも補給所
 * でも可）へ即座に落とす」という受動的な判定にしている。補給所でも搬入完了
 * 扱いになるため、最初に触れたアンカー（＝実質的に最寄りの補給所）へ落とせば
 * よく、毎回拠点まで戻る必要がない。
 *
 * 【建設の集中回避（リーダー選出）】
 * ladder.tsと全く同じ問題——建設が無コストなため、分離力なしに密集した複数
 * boidがほぼ同tickに閾値を超え、同じ場所に重複した補給所の山ができてしまう
 * ——がここでも起こるため、対策も同じ形（memory[INTENT_SLOT]による意思表示
 * ＋util.tsのisLocalMaxによるID最大判定）で入れている。加えて「意思表示を
 * 出し始めたそのtickでは建設を許可せず、前tickから連続して意思表示していた
 * 場合のみ許可する」(wasIntending)という1tick分の据え置きも同様に必要——
 * これはsimulate.tsのmemory書き戻しタイミングに起因する同tick内の非対称な
 * リーク（IDが若いboidの今tickの書き込みは同tick内でIDが大きいboidから見える
 * が、逆は見えない）により、1tickだけの判定だと複数個体が同tickに重複して
 * 建設してしまうケースがあるため。詳しい仕組みと正しさの根拠はladder.tsの
 * 該当コメントを参照。
 *
 * 建設は空荷(cargo===0)のときだけ試みる。復路(cargo>0)の間はwantsToBuildを
 * 常にfalseとして扱い、意思表示(memory[INTENT_SLOT])も自然に0へ戻る——
 * 荷物を届けに戻っている個体がリーダー選出に参加し続けて他個体の建設判断を
 * 誤らせることのないようにするため。
 *
 * 加えて、視界内にmaxLineLength以内のアンカーが1つでも見えていれば無条件で
 * wantsToBuildを取り下げる（nearVisibleAnchor）。リーダー選出は同tickの重複は
 * 防ぐが、敗れた側がinteractRadius(dead reckoningのリセット判定)よりわずかに
 * 遠い位置にいると、勝者の建設後もリセットされずに閾値を超え続け、勝者が
 * 意思表示をやめた次のtickに「競争相手がいない」と誤認識してもう1つ近くに
 * 建ててしまうケースがヘッドレスで見つかったため。詳しくはladder.tsの該当
 * コメントを参照。
 *
 * 検証中の仮説であり、これだけで安定して資源を回収し続けられるかは未確認。
 * headlessで実際に走らせながら詰まった箇所を直す想定のスタート地点。
 */
export const supplyLineProgram: Program = (self, neighbors) => {
  const wasIntending = self.memory[INTENT_SLOT] === 1; // このtickで上書きする前に、前tick終了時点の意思表示を読んでおく

  self.memory[0] += self.vel.x;
  self.memory[1] += self.vel.y;

  const anchors = neighbors.filter((n) => n.kind === 'base' || n.kind === 'station');
  const atAnchor = anchors.length > 0 && length(closest(anchors).relPos) < PHYSICS.interactRadius;
  if (atAnchor) {
    self.memory[0] = 0;
    self.memory[1] = 0;
  }

  let steer = EXPLORE_DIR;
  let harvest = false;
  let drop = false;

  if (self.cargo > 0) {
    steer = RETURN_DIR;
    drop = anchors.length > 0 && length(closest(anchors).relPos) < PHYSICS.interactRadius;
  } else {
    const resources = neighbors.filter((n) => n.kind === 'resource' && (n.amount ?? 0) > 0);
    if (resources.length > 0) {
      const res = closest(resources);
      steer = normalize(res.relPos);
      harvest = length(res.relPos) < PHYSICS.interactRadius;
    }
  }

  // 空荷のときだけ建設を試みる。資源が見えているかどうかは問わない
  // （逸れた経路の先でも建設することで、結果的にラダーが資源方向へ伸びる）。
  const nearVisibleAnchor = anchors.some((a) => length(a.relPos) < PHYSICS.maxLineLength);
  const estDist = length({ x: self.memory[0], y: self.memory[1] });
  const wantsToBuild = self.cargo === 0 && !nearVisibleAnchor && estDist > PHYSICS.maxLineLength * BUILD_MARGIN;
  self.memory[INTENT_SLOT] = wantsToBuild ? 1 : 0;

  const intendingPeers = neighbors.filter((n) => n.kind === 'boid' && n.memory?.[INTENT_SLOT] === 1);
  const build = wantsToBuild && wasIntending && isLocalMax(self.id, intendingPeers);

  return { vel: scale(steer, PHYSICS.maxSpeed), harvest, drop, build };
};
