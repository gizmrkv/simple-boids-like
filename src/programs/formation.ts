import type { Program } from '../perception';
import { add, length, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest } from './util';

export const TARGET_RADIUS = 35; // 拠点から維持したい距離（viewRadius内に収まる値にしてある）
const SPRING_K = 3;
const DAMP_K = 4; // 減衰項。無いとバネ力だけで振動が発散し視界外へ弾き出されてしまう
const SEPARATION_RADIUS = 25;
const SEPARATION_K = 15;

/**
 * 局所ルールだけで拠点の周囲に陣形（リング）を作り維持する。
 * 「拠点までの距離を一定に保とうとするバネ力＋減衰力」と「近すぎる仲間からの
 * 分離力」の組み合わせだけで、全体としては均等に散らばったリングが自己組織化される。
 * memory[0..1] には拠点からの推定変位を積んでおき、万一振動で視界外に
 * 出てしまっても dead reckoning で戻れるようにしている。
 */
export const formationProgram: Program = (self, neighbors, world) => {
  self.memory[0] += self.vel.x * world.dt;
  self.memory[1] += self.vel.y * world.dt;

  const bases = neighbors.filter((n) => n.kind === 'base');
  const others = neighbors.filter((n) => n.kind === 'boid');

  let accel: ReturnType<typeof zero>;

  if (bases.length > 0) {
    const anchor = closest(bases);
    self.memory[0] = -anchor.relPos.x; // 見えている間は毎tick補正し、ドリフトを消す
    self.memory[1] = -anchor.relPos.y;

    const dist = length(anchor.relPos);
    const dir = normalize(anchor.relPos);
    const error = dist - TARGET_RADIUS; // 正: 遠すぎる、負: 近すぎる
    accel = add(scale(dir, error * SPRING_K), scale(self.vel, -DAMP_K));
  } else {
    // 振動などで視界外に出てしまったら、dead reckoningで拠点方向へ戻る
    const homeDir = normalize(scale({ x: self.memory[0], y: self.memory[1] }, -1));
    accel = scale(homeDir, PHYSICS.maxAccel);
  }

  let separation = zero();
  for (const o of others) {
    const d = length(o.relPos);
    if (d > 0 && d < SEPARATION_RADIUS) separation = add(separation, scale(o.relPos, -1 / d));
  }
  accel = add(accel, scale(separation, SEPARATION_K));

  return { accel };
};
