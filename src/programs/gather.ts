import type { Program } from '../perception';
import { add, length, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest } from './util';

const SEPARATION_RADIUS = 15;

/**
 * 資源を見つけて拠点まで運ぶ。memory[0..1] に拠点からの推定変位を
 * dead reckoning（自分の速度の積分）で記録し、拠点が視界外でも
 * 戻る方向を推定できるようにしている。
 */
export const gatherProgram: Program = (self, neighbors, world) => {
  self.memory[0] += self.vel.x * world.dt;
  self.memory[1] += self.vel.y * world.dt;

  const resources = neighbors.filter((n) => n.kind === 'resource' && (n.amount ?? 0) > 0);
  const bases = neighbors.filter((n) => n.kind === 'base');
  const others = neighbors.filter((n) => n.kind === 'boid');

  let separation = zero();
  for (const o of others) {
    const d = length(o.relPos);
    if (d > 0 && d < SEPARATION_RADIUS) separation = add(separation, scale(o.relPos, -1 / d));
  }

  let steer = zero();
  let nearestBaseDist = Infinity;
  let nearestResDist = Infinity;

  if (self.cargo > 0) {
    if (bases.length > 0) {
      const base = closest(bases);
      nearestBaseDist = length(base.relPos);
      steer = normalize(base.relPos);
    } else {
      // 拠点が視界になければ、dead reckoningで戻る方向を推定する
      steer = normalize(scale({ x: self.memory[0], y: self.memory[1] }, -1));
    }
  } else if (resources.length > 0) {
    const res = closest(resources);
    nearestResDist = length(res.relPos);
    steer = normalize(res.relPos);
  } else {
    // 何も見えていなければ、自分のIDに応じた固定方向へ直進して探索する
    steer = length(self.vel) > 1 ? normalize(self.vel) : { x: Math.cos(self.id), y: Math.sin(self.id) };
  }

  const accel = add(scale(steer, PHYSICS.maxAccel), scale(separation, PHYSICS.maxAccel * 0.6));
  const drop = self.cargo > 0 && nearestBaseDist < PHYSICS.interactRadius;
  if (drop) {
    self.memory[0] = 0;
    self.memory[1] = 0;
  }

  return {
    accel,
    harvest: self.cargo === 0 && nearestResDist < PHYSICS.interactRadius,
    drop,
  };
};
