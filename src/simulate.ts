import { add, fromPolar, length, sub } from './vec2';
import type { Action, Program } from './perception';
import { buildNeighbors, buildSelfView, buildWorldView } from './perception';
import type { World } from './world';
import { createStation, PHYSICS } from './world';

export function step(world: World, program: Program): void {
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

    // 燃料切れの間はheading・speedとも変更できず停止する（無料での旋回もできない）
    if (boid.fuel > 0) {
      boid.heading += action.turn;
      boid.speed = Math.min(Math.max(action.speed, 0), PHYSICS.maxSpeed);
    } else {
      boid.speed = 0;
    }

    const prevPos = boid.pos;
    boid.pos = add(boid.pos, fromPolar(boid.heading, boid.speed)); // 次tickの位置 = 現在位置 + 速度ベクトル
    bounceOffWalls(boid, world);
    boid.fuel = Math.max(0, boid.fuel - length(sub(boid.pos, prevPos)) * PHYSICS.fuelBurnRate);

    if (action.harvest && boid.cargo === 0) {
      const target = nearestWithin(boid.pos, world.resources.filter((r) => r.amount > 0), PHYSICS.interactRadius);
      if (target) {
        target.amount -= 1;
        boid.cargo += 1;
      }
    }

    if (action.drop && boid.cargo > 0) {
      const target = nearestWithin(boid.pos, [...world.bases, ...world.stations], PHYSICS.interactRadius);
      if (target) {
        world.stored += boid.cargo;
        boid.cargo = 0;
      }
    }

    if (action.handoff && boid.cargo > 0) {
      const others = world.boids.filter((b) => b.id !== boid.id && b.cargo === 0);
      const target = nearestWithin(boid.pos, others, PHYSICS.interactRadius);
      if (target) {
        target.cargo += boid.cargo;
        boid.cargo = 0;
      }
    }

    if (action.build) {
      const anchors = [...world.bases, ...world.stations];
      const nearAnchor = nearestWithin(boid.pos, anchors, PHYSICS.maxLineLength);
      if (nearAnchor) {
        world.stations.push(createStation(boid.pos));
      }
    }

    // 拠点・補給所の近くにいる間は燃料が全回復する。
    // 燃料無制限のboid（Infinity）はそもそも対象外。
    if (
      Number.isFinite(boid.fuel) &&
      (nearestWithin(boid.pos, world.bases, PHYSICS.interactRadius) ||
        nearestWithin(boid.pos, world.stations, PHYSICS.interactRadius))
    ) {
      boid.fuel = PHYSICS.maxFuel;
    }
  });

  world.tick += 1;
}

// 境界に当たった場合のみ、反射後の速度ベクトルからheadingを再計算する
// （speedは不変）。当たっていないtickでheadingを毎回atan2で再計算すると、
// speed=0のときにheadingが0へ巻き戻ってしまうため、実際に反射が起きた
// ときだけ書き換える。
function bounceOffWalls(boid: World['boids'][number], world: World): void {
  const vel = fromPolar(boid.heading, boid.speed);
  let bounced = false;

  if (boid.pos.x < 0) {
    boid.pos.x = 0;
    vel.x = Math.abs(vel.x);
    bounced = true;
  } else if (boid.pos.x > world.width) {
    boid.pos.x = world.width;
    vel.x = -Math.abs(vel.x);
    bounced = true;
  }
  if (boid.pos.y < 0) {
    boid.pos.y = 0;
    vel.y = Math.abs(vel.y);
    bounced = true;
  } else if (boid.pos.y > world.height) {
    boid.pos.y = world.height;
    vel.y = -Math.abs(vel.y);
    bounced = true;
  }

  if (bounced && boid.speed > 0) {
    boid.heading = Math.atan2(vel.y, vel.x);
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
