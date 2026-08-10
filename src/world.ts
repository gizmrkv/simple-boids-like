import type { Vec2 } from './vec2';
import { zero } from './vec2';

/** boidが内部に保持できるメモリのスロット数（読み書き可能な状態）。 */
export const MEMORY_SIZE = 4;

export const PHYSICS = {
  maxSpeed: 1, // 1tickで動ける距離の上限（速度ベクトルの大きさの上限）
  viewRadius: 60, // 知覚できる半径
  interactRadius: 8, // 資源採取・拠点搬入・boid間の受け渡しができる半径
  maxFuel: 260, // 移動できる総距離の上限。拠点に近づくと全回復する
  fuelBurnRate: 1, // 単位距離あたりの燃料消費量
  maxLineLength: 100, // 既存の拠点/補給所からこの距離以内でないと新しい補給所を建設できない
};

export interface Boid {
  id: number;
  pos: Vec2; // 絶対位置（perception層の外には渡さない）
  vel: Vec2; // 絶対速度。次tickの位置は pos + vel で決まる
  memory: number[]; // 内部メモリ、長さ MEMORY_SIZE
  cargo: number; // 運搬中の資源量（0 or 1）
  fuel: number; // 残燃料。0になると速度を変更できなくなる
}

export interface ResourceNode {
  id: number;
  pos: Vec2;
  amount: number;
}

export interface Base {
  id: number;
  pos: Vec2;
}

export interface Station {
  id: number;
  pos: Vec2;
  // pos以外の「距離の推定値」のような付随情報は意図的に持たせない。
  // 「建設時点の推定値をずっと保持している」状態を避けるため。
}

export interface World {
  width: number;
  height: number;
  tick: number;
  boids: Boid[];
  resources: ResourceNode[];
  bases: Base[];
  stations: Station[]; // 建設され増減する補給所。bases/resourcesと違い実行中に増える
  stored: number; // 拠点・補給所を問わず搬入(drop)された資源の合計。グローバルに管理する
}

let nextId = 0;
const freshId = (): number => nextId++;

// 既定は燃料無制限。行動範囲を制限したいシナリオ（中継リレー輸送）だけ
// PHYSICS.maxFuel などの有限値を明示的に渡す。
export function createBoid(pos: Vec2, vel: Vec2 = zero(), fuel: number = Infinity): Boid {
  return {
    id: freshId(),
    pos,
    vel,
    memory: new Array(MEMORY_SIZE).fill(0),
    cargo: 0,
    fuel,
  };
}

export function createResource(pos: Vec2, amount: number): ResourceNode {
  return { id: freshId(), pos, amount };
}

export function createBase(pos: Vec2): Base {
  return { id: freshId(), pos };
}

export function createStation(pos: Vec2): Station {
  return { id: freshId(), pos };
}

export function createWorld(width: number, height: number): World {
  return { width, height, tick: 0, boids: [], resources: [], bases: [], stations: [], stored: 0 };
}
