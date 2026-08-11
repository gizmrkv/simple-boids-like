import type { Vec2 } from '../vec2';
import { add, fromPolar } from '../vec2';

/**
 * 地形の実装が満たすべき最小インターフェース。生成アルゴリズム（セルオートマトン、
 * 将来のマーチングスクエアなど）を差し替え可能にするため、raycastはこの
 * isBlockedだけを使って実装する（下記raycast参照）。
 */
export interface Terrain {
  isBlocked(pos: Vec2): boolean;
}

/**
 * originからangle方向にmaxRangeまで、step刻みでisBlockedを呼びながら前進し、
 * 最初に障害物にぶつかった距離を返す。範囲内に何もなければInfinity。
 * DDAのようなセル境界の厳密計算はせず固定ステップの線分マーチングだが、
 * PHYSICS.maxSpeed=1のこの世界ではstep=1で十分な精度になる。
 */
export function raycast(terrain: Terrain, origin: Vec2, angle: number, maxRange: number, step = 1): number {
  let pos = origin;
  const dir = fromPolar(angle, step);
  for (let d = step; d <= maxRange; d += step) {
    pos = add(pos, dir);
    if (terrain.isBlocked(pos)) return d;
  }
  return Infinity;
}
