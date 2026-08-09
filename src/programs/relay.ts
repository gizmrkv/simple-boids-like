import type { Program } from '../perception';
import { length, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest } from './util';

// 資源は拠点からほぼ真東にある、というこのシナリオ固有のレイアウト知識を
// 定数として埋め込んでいる（マップ形状を知った上でプログラムを書く前提）。
const EXPLORE_DIR = { x: 1, y: 0 };
const FUEL_RETURN_RATIO = 0.5; // 残燃料がこの割合を切ったら復路優先に切り替える

/**
 * 拠点〜資源間が1boidの燃料（行動範囲）を超える距離にあるシナリオ用の
 * 出発点となる実装。個体に固定の役割は割り振らず、全員が同じ単純な
 * 規則（空荷なら往復パトロール、燃料が減れば持ち帰りやすい相手に近寄って
 * 手渡す）に従うだけで、結果としてリレーが自己組織化することを狙っている。
 *
 * 検証中の仮説であり、これだけで安定して勝利条件を満たすかは未確認。
 * ここから実際にプレイして詰まった箇所を直す想定のスタート地点。
 */
export const relayProgram: Program = (self, neighbors) => {
  self.memory[0] += self.vel.x;
  self.memory[1] += self.vel.y;
  const homeDir = normalize(scale({ x: self.memory[0], y: self.memory[1] }, -1));

  const resources = neighbors.filter((n) => n.kind === 'resource' && (n.amount ?? 0) > 0);
  const bases = neighbors.filter((n) => n.kind === 'base');
  const carriers = neighbors.filter((n) => n.kind === 'boid' && (n.cargo ?? 0) > 0);
  const empties = neighbors.filter((n) => n.kind === 'boid' && (n.cargo ?? 0) === 0);
  const lowFuel = self.fuel < PHYSICS.maxFuel * FUEL_RETURN_RATIO;

  let steer = zero();
  let harvest = false;
  let drop = false;
  let handoff = false;

  if (self.cargo > 0) {
    if (bases.length > 0) {
      const base = closest(bases);
      steer = normalize(base.relPos);
      drop = length(base.relPos) < PHYSICS.interactRadius;
    } else {
      steer = homeDir;
      if (empties.length > 0) {
        const nearest = closest(empties);
        const d = length(nearest.relPos);
        if (d < PHYSICS.interactRadius) {
          handoff = true; // すれ違いざまに空荷の仲間へ渡しておく
        } else if (lowFuel) {
          steer = normalize(nearest.relPos); // 燃料が少なければ積極的に相手へ寄る
        }
      }
    }
  } else if (resources.length > 0) {
    const res = closest(resources);
    steer = normalize(res.relPos);
    harvest = length(res.relPos) < PHYSICS.interactRadius;
  } else if (carriers.length > 0) {
    steer = normalize(closest(carriers).relPos); // 荷物を持つ仲間に近づいて受け取る
  } else {
    steer = lowFuel ? homeDir : EXPLORE_DIR;
  }

  if (drop) {
    self.memory[0] = 0;
    self.memory[1] = 0;
  }

  return { vel: scale(steer, PHYSICS.maxSpeed), harvest, drop, handoff };
};
