import type { Program } from '../perception';
import { length, normalize, scale } from '../vec2';
import { PHYSICS } from '../world';
import { closest } from './util';

// 資源は拠点からほぼ真東にある、というこのシナリオ固有のレイアウト知識を
// 定数として埋め込んでいる（relay.ts/ladder.tsと同じ考え方）。
const EXPLORE_DIR = { x: 1, y: 0 };
const RETURN_DIR = { x: -1, y: 0 };
const BUILD_MARGIN = 0.9; // maxLineLengthのこの割合まで離れたら建設を試み始める（ladder.tsと同じ）

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
 * 進行方向を特定のアンカーに依存させる必要はない。
 *
 * 検証中の仮説であり、これだけで安定して資源を回収し続けられるかは未確認。
 * headlessで実際に走らせながら詰まった箇所を直す想定のスタート地点。
 */
export const supplyLineProgram: Program = (self, neighbors) => {
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
    const bases = neighbors.filter((n) => n.kind === 'base');
    steer = RETURN_DIR;
    drop = bases.length > 0 && length(closest(bases).relPos) < PHYSICS.interactRadius;
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
  const estDist = length({ x: self.memory[0], y: self.memory[1] });
  const build = self.cargo === 0 && estDist > PHYSICS.maxLineLength * BUILD_MARGIN;

  return { vel: scale(steer, PHYSICS.maxSpeed), harvest, drop, build };
};
