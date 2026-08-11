import type { Program } from '../perception';
import { length, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest, toAction, updateDeadReckoning } from './util';

/**
 * 資源を見つけて拠点まで運ぶ。memory[0..1] に拠点からの推定変位を
 * dead reckoning（今tick分のturn/speedの回転補正付き積算）で記録し、
 * 拠点が視界外でも戻る方向を推定できるようにしている。
 */
export const gatherProgram: Program = (self, neighbors) => {
  const resources = neighbors.filter((n) => n.kind === 'resource' && (n.amount ?? 0) > 0);
  const bases = neighbors.filter((n) => n.kind === 'base');

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
    // 何も見えていなければ直進（turn=0）で探索する。ただしスポーン直後
    // (speedがまだ小さい)だけは自分のIDに応じた固定方向を初期値にする
    steer = self.speed > PHYSICS.maxSpeed * 0.1 ? { x: 1, y: 0 } : { x: Math.cos(self.id), y: Math.sin(self.id) };
  }

  const action = toAction(steer);
  const drop = self.cargo > 0 && nearestBaseDist < PHYSICS.interactRadius;
  if (drop) {
    self.memory[0] = 0;
    self.memory[1] = 0;
  } else {
    updateDeadReckoning(self.memory, action.turn, action.speed);
  }

  return {
    ...action,
    harvest: self.cargo === 0 && nearestResDist < PHYSICS.interactRadius,
    drop,
  };
};
