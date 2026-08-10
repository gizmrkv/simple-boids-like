import type { Program } from '../perception';
import { length, limit, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest } from './util';

export const TARGET_RADIUS = 35; // 拠点から維持したい距離（viewRadius内に収まる値にしてある）
const APPROACH_K = 0.05; // 距離誤差にどれだけ敏感に速度を出すか

/**
 * 局所ルールだけで拠点の周囲に陣形（リング）を作り維持する。
 * 「拠点までの距離誤差に比例した速度で近づく/離れる」動きだけで、全体としては
 * 均等に散らばったリングが自己組織化される。memory[0..1] には拠点からの推定
 * 変位を積んでおき、万一視界外に出てしまっても dead reckoning で戻れるように
 * している。
 */
export const formationProgram: Program = (self, neighbors) => {
  self.memory[0] += self.vel.x;
  self.memory[1] += self.vel.y;

  const bases = neighbors.filter((n) => n.kind === 'base');

  let vel: ReturnType<typeof zero>;

  if (bases.length > 0) {
    const anchor = closest(bases);
    self.memory[0] = -anchor.relPos.x; // 見えている間は毎tick補正し、ドリフトを消す
    self.memory[1] = -anchor.relPos.y;

    const dist = length(anchor.relPos);
    const dir = normalize(anchor.relPos);
    const error = dist - TARGET_RADIUS; // 正: 遠すぎる、負: 近すぎる
    vel = scale(dir, error * APPROACH_K);
  } else {
    // 視界外に出てしまったら、dead reckoningで拠点方向へ戻る
    const homeDir = normalize(scale({ x: self.memory[0], y: self.memory[1] }, -1));
    vel = scale(homeDir, PHYSICS.maxSpeed);
  }

  return { vel: limit(vel, PHYSICS.maxSpeed) };
};
