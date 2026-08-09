import type { Vec2 } from './vec2';
import { zero } from './vec2';

/** boidが内部に保持できるメモリのスロット数（読み書き可能な状態）。 */
export const MEMORY_SIZE = 4;

export const PHYSICS = {
  maxSpeed: 40, // units/sec
  maxAccel: 60, // units/sec^2
  viewRadius: 60, // 知覚できる半径
  interactRadius: 8, // 資源採取・拠点搬入ができる半径
};

export interface Boid {
  id: number;
  pos: Vec2; // 絶対位置（perception層の外には渡さない）
  vel: Vec2; // 絶対速度
  memory: number[]; // 内部メモリ、長さ MEMORY_SIZE
  cargo: number; // 運搬中の資源量（0 or 1）
}

export interface ResourceNode {
  id: number;
  pos: Vec2;
  amount: number;
}

export interface Base {
  id: number;
  pos: Vec2;
  stored: number;
}

export interface World {
  width: number;
  height: number;
  tick: number;
  boids: Boid[];
  resources: ResourceNode[];
  bases: Base[];
}

let nextId = 0;
const freshId = (): number => nextId++;

export function createBoid(pos: Vec2, vel: Vec2 = zero()): Boid {
  return {
    id: freshId(),
    pos,
    vel,
    memory: new Array(MEMORY_SIZE).fill(0),
    cargo: 0,
  };
}

export function createResource(pos: Vec2, amount: number): ResourceNode {
  return { id: freshId(), pos, amount };
}

export function createBase(pos: Vec2): Base {
  return { id: freshId(), pos, stored: 0 };
}

export function createWorld(width: number, height: number): World {
  return { width, height, tick: 0, boids: [], resources: [], bases: [] };
}
