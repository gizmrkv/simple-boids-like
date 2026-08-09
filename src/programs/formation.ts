import type { Program } from '../perception';
import { add, length, normalize, scale, zero } from '../vec2';
import { closest } from './util';

export const TARGET_RADIUS = 35; // 拠点から維持したい距離（viewRadius内に収まる値にしてある）
const SPRING_K = 3;
const SEPARATION_RADIUS = 25;
const SEPARATION_K = 40;

/**
 * 局所ルールだけで拠点の周囲に陣形（リング）を作り維持する。
 * 「拠点までの距離を一定に保とうとするバネ力」と「近すぎる仲間からの分離力」
 * の組み合わせだけで、全体としては均等に散らばったリングが自己組織化される。
 */
export const formationProgram: Program = (_self, neighbors) => {
  const bases = neighbors.filter((n) => n.kind === 'base');
  const others = neighbors.filter((n) => n.kind === 'boid');

  let accel = zero();

  if (bases.length > 0) {
    const anchor = closest(bases);
    const dist = length(anchor.relPos);
    const dir = normalize(anchor.relPos);
    const error = dist - TARGET_RADIUS; // 正: 遠すぎる、負: 近すぎる
    accel = add(accel, scale(dir, error * SPRING_K));
  }

  let separation = zero();
  for (const o of others) {
    const d = length(o.relPos);
    if (d > 0 && d < SEPARATION_RADIUS) separation = add(separation, scale(o.relPos, -1 / d));
  }
  accel = add(accel, scale(separation, SEPARATION_K));

  return { accel };
};
