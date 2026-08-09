import type { Vec2 } from './vec2';
import { length, sub, zero } from './vec2';
import type { Boid, World } from './world';
import { PHYSICS } from './world';

export type NeighborKind = 'boid' | 'resource' | 'base';

export interface NeighborView {
  kind: NeighborKind;
  relPos: Vec2; // 知覚元boidを原点とした相対位置
  relVel: Vec2; // 相対速度（資源・拠点は静止しているので -selfVel）
  amount?: number; // resource: 残量 / base: 貯蔵量
  memory?: readonly number[]; // kind === 'boid' のときだけ、読み取り専用スナップショット
}

export interface SelfView {
  vel: Readonly<Vec2>; // 自分の絶対速度（絶対位置は渡さない）
  cargo: number;
  memory: number[]; // 書き換え可能なコピー。simulateがtick後にboidへ書き戻す
}

export interface WorldView {
  tick: number;
  width: number;
  height: number;
}

export interface Action {
  accel: Vec2; // 望みの加速度。PHYSICS.maxAccel でクランプされる
  harvest?: boolean; // interactRadius内の資源から採取を試みる
  drop?: boolean; // interactRadius内の拠点へ搬入を試みる
}

export type Program = (self: SelfView, neighbors: NeighborView[], world: WorldView) => Action;

export function buildSelfView(boid: Boid): SelfView {
  return { vel: boid.vel, cargo: boid.cargo, memory: [...boid.memory] };
}

export function buildWorldView(world: World): WorldView {
  return { tick: world.tick, width: world.width, height: world.height };
}

export function buildNeighbors(boid: Boid, world: World): NeighborView[] {
  const neighbors: NeighborView[] = [];
  const r = PHYSICS.viewRadius;

  for (const other of world.boids) {
    if (other.id === boid.id) continue;
    const relPos = sub(other.pos, boid.pos);
    if (length(relPos) > r) continue;
    neighbors.push({
      kind: 'boid',
      relPos,
      relVel: sub(other.vel, boid.vel),
      memory: other.memory,
    });
  }

  for (const res of world.resources) {
    const relPos = sub(res.pos, boid.pos);
    if (length(relPos) > r) continue;
    neighbors.push({ kind: 'resource', relPos, relVel: sub(zero(), boid.vel), amount: res.amount });
  }

  for (const base of world.bases) {
    const relPos = sub(base.pos, boid.pos);
    if (length(relPos) > r) continue;
    neighbors.push({ kind: 'base', relPos, relVel: sub(zero(), boid.vel), amount: base.stored });
  }

  return neighbors;
}
