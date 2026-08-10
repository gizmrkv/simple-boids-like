import type { Program } from '../perception';
import { length, scale } from '../vec2';
import { PHYSICS } from '../world';
import { closest } from './util';

// 拠点からほぼ真東に伸ばす、というこのシナリオ固有のレイアウト知識を定数として
// 埋め込んでいる（relay.tsのEXPLORE_DIRと同じ考え方）。
const EXPLORE_DIR = { x: 1, y: 0 };
const BUILD_MARGIN = 0.9; // maxLineLengthのこの割合まで離れたら建設を試み始める

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
 * 検証中の仮説であり、これだけで安定してラダーが伸びるかは未確認。headlessで
 * 実際に走らせながら詰まった箇所を直す想定のスタート地点。
 */
export const ladderProgram: Program = (self, neighbors) => {
  self.memory[0] += self.vel.x;
  self.memory[1] += self.vel.y;

  const anchors = neighbors.filter((n) => n.kind === 'base' || n.kind === 'station');
  const atAnchor = anchors.length > 0 && length(closest(anchors).relPos) < PHYSICS.interactRadius;
  if (atAnchor) {
    self.memory[0] = 0;
    self.memory[1] = 0;
  }

  const estDist = length({ x: self.memory[0], y: self.memory[1] });
  const build = estDist > PHYSICS.maxLineLength * BUILD_MARGIN;

  return { vel: scale(EXPLORE_DIR, PHYSICS.maxSpeed), build };
};
