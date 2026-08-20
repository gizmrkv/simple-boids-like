import { add, fromPolar, length, scale, sub, zero } from './vec2';
import type { Vec2 } from './vec2';
import type { Action, Program } from './perception';
import { buildNeighbors, buildSelfView, buildWorldView } from './perception';
import type { Terrain } from './terrain/types';
import type { World } from './world';
import { CARRY_RADIUS, createStation, PHYSICS } from './world';

export function step(world: World, program: Program): void {
  // 1. 現在の状態を元に、全boid分のactionを先に集める（順序依存を避ける）
  const actions: Action[] = world.boids.map((boid) => {
    const self = buildSelfView(boid, world);
    const neighbors = buildNeighbors(boid, world);
    const worldView = buildWorldView(world);
    const action = program(self, neighbors, worldView);
    boid.memory = self.memory; // 書き換えられたメモリを書き戻す
    return action;
  });

  // 2. 物理・アクションを適用
  world.boids.forEach((boid, i) => {
    const action = actions[i];

    // 燃料切れ中も旋回は制限なし。速度だけmaxSpeedのemptyFuelSpeedRatio倍まで
    // に制限される（Factorioのロボットが電力不足時に速度低下するのと同じ
    // 発想。以前は完全停止だったが、ユーザーの要求で「遅くなるが動ける」に
    // 変更した）。
    const speedCap = boid.fuel > 0 ? PHYSICS.maxSpeed : PHYSICS.maxSpeed * PHYSICS.emptyFuelSpeedRatio;
    boid.heading += action.turn;
    boid.speed = Math.min(Math.max(action.speed, 0), speedCap);

    const prevPos = boid.pos;
    const vel = fromPolar(boid.heading, boid.speed);
    boid.pos = moveWithTerrain(boid.pos, vel, world.terrain);
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

  // 3. 協調搬送資源: フェーズ1のactions（tick開始時点のcarry意思表示）と
  //    フェーズ2適用後のboid位置/heading/speedを使い、requiredCarriers体以上が
  //    同時にCARRY_RADIUS内でcarry:trueなら実速度の平均で資源を動かす。
  world.heavyResources = world.heavyResources.filter((hr) => {
    const carrierIndices = world.boids
      .map((_, i) => i)
      .filter((i) => actions[i].carry && length(sub(world.boids[i].pos, hr.pos)) <= CARRY_RADIUS);

    if (carrierIndices.length >= hr.requiredCarriers) {
      const vels = carrierIndices.map((i) => fromPolar(world.boids[i].heading, world.boids[i].speed));
      const avgVel = scale(vels.reduce((acc, v) => add(acc, v), zero()), 1 / vels.length);
      hr.pos = { x: hr.pos.x + avgVel.x, y: hr.pos.y + avgVel.y };
      hr.pos.x = Math.min(Math.max(hr.pos.x, 0), world.width);
      hr.pos.y = Math.min(Math.max(hr.pos.y, 0), world.height);
    }

    const delivered = nearestWithin(hr.pos, [...world.bases, ...world.stations], PHYSICS.interactRadius);
    if (delivered) {
      world.stored += 1;
      return false;
    }
    return true;
  });

  world.tick += 1;
}

// 地形に衝突したら停止するのではなく、速度ベクトルのうち壁と平行な成分
// （X軸・Y軸のうちブロックされていない方）だけを採用してズリズリ壁沿いに
// 動く。タイルベースの当たり判定でよく使われる、X軸・Y軸を分離して個別に
// 試す方式（対角移動がブロックされていても、片方の軸だけなら通ることが
// 多い）。両軸ともブロックされる場合（完全に行き止まり）だけ動かない。
function moveWithTerrain(pos: Vec2, vel: Vec2, terrain: Terrain | undefined): Vec2 {
  if (!terrain) return { x: pos.x + vel.x, y: pos.y + vel.y };

  const both = { x: pos.x + vel.x, y: pos.y + vel.y };
  if (!terrain.isBlocked(both)) return both;

  const onlyX = { x: pos.x + vel.x, y: pos.y };
  const onlyY = { x: pos.x, y: pos.y + vel.y };
  return {
    x: terrain.isBlocked(onlyX) ? pos.x : onlyX.x,
    y: terrain.isBlocked(onlyY) ? pos.y : onlyY.y,
  };
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
