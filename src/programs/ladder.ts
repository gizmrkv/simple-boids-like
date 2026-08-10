import type { Program } from '../perception';
import { length, scale } from '../vec2';
import { PHYSICS } from '../world';
import { closest, isLocalMax } from './util';

// 拠点からほぼ真東に伸ばす、というこのシナリオ固有のレイアウト知識を定数として
// 埋め込んでいる（relay.tsのEXPLORE_DIRと同じ考え方）。
const EXPLORE_DIR = { x: 1, y: 0 };
// maxLineLengthのこの割合まで離れたら建設を試み始める。0.9だと、dead reckoning
// が持つ系統的なズレ（interactRadius分だけ実際の距離より少なく見積もる）と
// リーダー選出の1tick分の据え置きが重なった際に、まれに実際の距離が
// maxLineLengthを超えてから初めて建設許可が下り、二度と建設できず立ち往生する
// ケースがヘッドレス検証で見つかった。0.75まで下げて安全マージンを広げている。
const BUILD_MARGIN = 0.75;
const INTENT_SLOT = 2; // memory[2]: 「今建設したい」という意思表示（1=あり/0=なし）。他boidから見える

/**
 * 拠点(または既存の補給所)から一定距離離れたら新しい補給所を建設し、そこを
 * 新しい起点としてさらに外側へ進む——を繰り返すことで、群れ全体としては拠点から
 * 外側へ伸びる補給所の「ラダー」が自己組織化されることを狙った出発点の実装。
 * 全個体が同じ規則・同じ探索方向に従うだけで役割分担はない。
 *
 * memory[0..1]には直前の既知アンカー(拠点 or 補給所)からの推定変位を
 * dead reckoningで積んでおく（gather.ts/formation.tsと同じ慣習）。建設コストは
 * 無いため毎tick build:trueを出し続けても無害——エンジン側がmaxLineLength内に
 * 実在のアンカーがあるときだけ実際に建設を成立させる（simulate.ts参照）。
 *
 * 【建設の集中回避（リーダー選出）】
 * ただし「無害」なのはsimulate.ts側の1個体分の判定の話であって、分離力なしに
 * 密集したまま移動する群れでは、ほぼ同tickで複数個体が同時にestDistの閾値を
 * 超え、全員が同tickでbuild:trueを出して同じ「rung」に重複した補給所の山が
 * できてしまう不具合が実際に起きていた（ヘッドレスで確認済み）。これを防ぐ
 * ため、TCP/リーダー選出に着想を得た単純な仕組みを入れている:
 *
 * - memory[INTENT_SLOT]を「今建設したいか」の意思表示として毎tick周囲に
 *   ブロードキャストする（1=意思あり/0=なし）。
 * - 視界内で意思表示中(memory[INTENT_SLOT]===1)の他boidの中に自分よりIDが
 *   大きい個体が1体もいなければ、自分が「ローカルでのID最大」として実際に
 *   build:trueを出す（util.tsのisLocalMax）。それ以外は意思表示だけして
 *   実際の建設は見送る。idはSelfView.idとして知覚元boid自身が常に知っている
 *   固定の属性で、cargoと同様perception.tsのNeighborViewにも構造的に持たせて
 *   あるため、memory越しに手動でブロードキャストする必要はない。
 *
 * 【なぜ「今tick中の1回だけの判定」では不十分か（非自明な仕様なので詳述する）】
 * simulate.tsのstep()は`world.boids.map(...)`で全boid分のactionを先に集めるが、
 * 各boidの`boid.memory = self.memory`という書き戻しは、そのmapの中で当該boid
 * を処理した直後・他のboidの処理を待たずに行われる。かつbuildNeighborsは
 * `other.memory`を（コピーではなく）Boidオブジェクトから直接参照している。
 * `world.boids`の並びは常にID昇順（createWorldでの生成順）なので、結果として
 * 「自分よりIDが若い(=自分より先に処理された)boidが今tick書いたばかりの
 * memoryは、自分から見える」が「自分よりIDが大きい(=自分より後に処理される)
 * boidが今tick書くmemoryは、自分からはまだ見えず前tick終了時点の値のまま」
 * という非対称なリークが生じる。（position/velocityは全boid分をいったん
 * actions配列に退避してから一括適用するのでこの問題はなく、影響するのは
 * memoryだけ。）
 *
 * この非対称性のせいで、意思表示を「今tickその場」だけで比較すると壊れる:
 * 低ID L と高ID H が同tickに同時に意思表示を始めたとする。Lが先に処理される
 * ため、Lからは「Hはまだ意思表示していない(前tickの値=0)」ように見え、Lは
 * 自分がローカル最大だと誤判定して建設してしまう。直後、同tick内でHが処理
 * されると、上記リークのおかげでHには「Lが今tick書いたばかりの意思表示
 * (=1)」が見えるが、HはLがすでに建設を実行済みであることまでは知らない。
 * IDだけで比較すればH>Lなので、Hも「自分がローカル最大」と誤判定し、同じ
 * tickにHも建設してしまう——結果、LとHが同tickに重複して建設する。
 *
 * これを避けるため、「意思表示を出し始めたそのtickでは実際の建設を許可せず、
 * “前tick終了時点で既に意思表示していた”場合(wasIntending)のみ建設を許可
 * する」という1tick分の据え置きを入れている。2tick目以降であれば、安定して
 * 意思表示を続けているboidは前tickと同じ値を再送しているだけなので、上記
 * リークによって「新しい値」を見ようが「古い値」を見ようが結果は変わらず、
 * 非対称性は実害を持たなくなる。
 *
 * 実際、wasIntending + isLocalMaxの2条件を課すと、「互いに視界内(viewRadius)
 * にいるboid同士では、1tickにつき建設できるのは高々1体」がグローバルに成立
 * することを示せる。あるboid Xがこのtickに建設したとする。isLocalMax(X)=true
 * は「Xより後に処理される、Xより高IDの全peerについて、Xから見える値（＝その
 * peer自身にとっての“前tick終了時点の値”＝自身のwasIntendingそのもの）が1
 * でない」ことを意味するので、Xより高IDの全peerはこのtick必ずwasIntending=
 * falseとなり建設できない。逆に、Xを視界に持つXより低いIDのpeer Zにとって、
 * Xの値は（Zより先には処理されないので）“前tick終了時点”の値として見える。
 * wasIntending(X)=trueである以上その値は1なので、isLocalMax(Z)は必ずfalseに
 * なり、Zも建設できない。（視界外にいる、互いに見えない別クラスタが同tickに
 * 独立して建設するのは別の話で、意図通り許容している。）
 *
 * 建設したboid自身は、次tick以降は自分が建てた新しい補給所そのものが
 * atAnchorの対象になり（既存のdead reckoningリセット処理）、estDistが0に
 * 落ちてwantsToBuildが自然にfalseへ戻る。
 *
 * 【敗れた側が「もう一段先」で重複建設してしまう別の穴（ヘッドレスで発見）】
 * 上記だけでは同tickの重複は防げても、敗れた側（isLocalMaxがfalseだった
 * 個体）が近くにもう1つ補給所を建ててしまうケースが残っていた。dead
 * reckoningのリセット判定(atAnchor)はinteractRadius(8)という狭い範囲でしか
 * 発動しないため、敗れた側が勝者の建設地点からinteractRadiusよりわずかに
 * 遠い位置にいると、リセットされないままestDistが閾値を超え続け、勝者が
 * 建設完了して意思表示をやめた次のtickに「もう競争相手がいない」と誤認識し
 * 自分も建ててしまう。これを防ぐため、dead reckoningのリセット判定
 * (interactRadius、精度重視でそのまま維持)とは別に、**視界内に
 * maxLineLength以内のアンカーが1つでも見えていたら無条件でwantsToBuildを
 * 取り下げる**ガードを追加している。relPosは推定ではなく真の相対位置なので、
 * dead reckoningの誤差に関係なく確実に効く。視界(viewRadius=60)の外まで
 * 出てしまえばこのガードは効かなくなるが、そこから先は素のdead reckoningの
 * 閾値判定（60 < 建設閾値75なので、通常の1体だけの前進では届く前に視界外に
 * 出るため元々問題にならない）に委ねる。
 *
 * 検証中の仮説であり、これだけで安定してラダーが伸びるかは未確認。headlessで
 * 実際に走らせながら詰まった箇所を直す想定のスタート地点。
 */
export const ladderProgram: Program = (self, neighbors) => {
  const wasIntending = self.memory[INTENT_SLOT] === 1; // このtickで上書きする前に、前tick終了時点の意思表示を読んでおく

  self.memory[0] += self.vel.x;
  self.memory[1] += self.vel.y;

  const anchors = neighbors.filter((n) => n.kind === 'base' || n.kind === 'station');
  const atAnchor = anchors.length > 0 && length(closest(anchors).relPos) < PHYSICS.interactRadius;
  if (atAnchor) {
    self.memory[0] = 0;
    self.memory[1] = 0;
  }

  const nearVisibleAnchor = anchors.some((a) => length(a.relPos) < PHYSICS.maxLineLength);
  const estDist = length({ x: self.memory[0], y: self.memory[1] });
  const wantsToBuild = !nearVisibleAnchor && estDist > PHYSICS.maxLineLength * BUILD_MARGIN;
  self.memory[INTENT_SLOT] = wantsToBuild ? 1 : 0;

  const intendingPeers = neighbors.filter((n) => n.kind === 'boid' && n.memory?.[INTENT_SLOT] === 1);
  const build = wantsToBuild && wasIntending && isLocalMax(self.id, intendingPeers);

  return { vel: scale(EXPLORE_DIR, PHYSICS.maxSpeed), build };
};
