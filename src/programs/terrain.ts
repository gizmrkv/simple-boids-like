import type { Program } from '../perception';
import { length, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest, toAction, updateDeadReckoning } from './util';

// この距離を切ったら回避操舵を混ぜ始める（frontDistが有効値を返す最大距離と
// 同じ＝何か検知した瞬間から反応を始める。半分の距離で反応し始めると、
// 通路が狭い地形では気づいたときには壁に近すぎて避けきれなかった）
const AVOID_DIST = PHYSICS.viewRadius;
// 完全に接近した(frontDist=0)ときの回避旋回量の上限
const MAX_AVOID_TURN = 0.5;

/**
 * gatherProgramと同じ探索・運搬ロジックに、前方の地形(self.frontDist)を
 * 使った回避操舵を混ぜたもの。回避方向はレイ1本では左右の区別がつかない
 * ため、self.idの偶奇で固定的に決める（個体ごとに一貫した方向に曲がるので、
 * 群れ全体が同じ側へ避け続けて渋滞するのを避けられる）。
 */
export const terrainProgram: Program = (self, neighbors) => {
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
      steer = normalize(scale({ x: self.memory[0], y: self.memory[1] }, -1));
    }
  } else if (resources.length > 0) {
    const res = closest(resources);
    nearestResDist = length(res.relPos);
    steer = normalize(res.relPos);
  } else {
    steer = self.speed > PHYSICS.maxSpeed * 0.1 ? { x: 1, y: 0 } : { x: Math.cos(self.id), y: Math.sin(self.id) };
  }

  let action = toAction(steer);
  const avoidStrength = Math.max(0, (AVOID_DIST - self.frontDist) / AVOID_DIST);
  if (avoidStrength > 0) {
    const avoidDir = self.id % 2 === 0 ? 1 : -1;
    action = {
      turn: action.turn + avoidDir * MAX_AVOID_TURN * avoidStrength,
      speed: action.speed * (1 - avoidStrength * 0.5), // 接近するほど減速し、行き過ぎを防ぐ
    };
  }

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
