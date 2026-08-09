import { add, length, limit, scale, sub } from './vec2';
import type { Action, Program } from './perception';
import { buildNeighbors, buildSelfView, buildWorldView } from './perception';
import type { World } from './world';
import { PHYSICS } from './world';

export function step(world: World, program: Program, dt: number): void {
  // 1. 現在の状態を元に、全boid分のactionを先に集める（順序依存を避ける）
  const actions: Action[] = world.boids.map((boid) => {
    const self = buildSelfView(boid);
    const neighbors = buildNeighbors(boid, world);
    const worldView = buildWorldView(world);
    const action = program(self, neighbors, worldView);
    boid.memory = self.memory; // 書き換えられたメモリを書き戻す
    return action;
  });

  // 2. 物理・アクションを適用
  world.boids.forEach((boid, i) => {
    const action = actions[i];

    const accel = limit(action.accel, PHYSICS.maxAccel);
    boid.vel = limit(add(boid.vel, scale(accel, dt)), PHYSICS.maxSpeed);
    boid.pos = add(boid.pos, scale(boid.vel, dt));
    bounceOffWalls(boid, world);

    if (action.harvest && boid.cargo === 0) {
      const target = nearestWithin(boid.pos, world.resources.filter((r) => r.amount > 0), PHYSICS.interactRadius);
      if (target) {
        target.amount -= 1;
        boid.cargo += 1;
      }
    }

    if (action.drop && boid.cargo > 0) {
      const target = nearestWithin(boid.pos, world.bases, PHYSICS.interactRadius);
      if (target) {
        target.stored += boid.cargo;
        boid.cargo = 0;
      }
    }
  });

  world.tick += 1;
}

function bounceOffWalls(boid: World['boids'][number], world: World): void {
  if (boid.pos.x < 0) {
    boid.pos.x = 0;
    boid.vel.x = Math.abs(boid.vel.x);
  } else if (boid.pos.x > world.width) {
    boid.pos.x = world.width;
    boid.vel.x = -Math.abs(boid.vel.x);
  }
  if (boid.pos.y < 0) {
    boid.pos.y = 0;
    boid.vel.y = Math.abs(boid.vel.y);
  } else if (boid.pos.y > world.height) {
    boid.pos.y = world.height;
    boid.vel.y = -Math.abs(boid.vel.y);
  }
}

function nearestWithin<T extends { pos: { x: number; y: number } }>(
  from: { x: number; y: number },
  candidates: T[],
  radius: number,
): T | undefined {
  let best: T | undefined;
  let bestDist = radius;
  for (const c of candidates) {
    const d = length(sub(c.pos, from));
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}
