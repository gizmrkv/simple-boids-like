import type { Vec2 } from './vec2';
import type { Terrain } from './terrain/types';

/** boidが内部に保持できるメモリのスロット数（読み書き可能な状態）。 */
export const MEMORY_SIZE = 32;

export const PHYSICS = {
  maxSpeed: 1, // 1tickで動ける距離の上限（速度ベクトルの大きさの上限）
  viewRadius: 60, // 知覚できる半径
  interactRadius: 8, // 資源採取・拠点搬入・boid間の受け渡しができる半径
  maxFuel: 260, // 移動できる総距離の上限。拠点に近づくと全回復する
  fuelBurnRate: 1, // 単位距離あたりの燃料消費量
  maxLineLength: 100, // 既存の拠点/補給所からこの距離以内でないと新しい補給所を建設できない
  emptyFuelSpeedRatio: 0.2, // 燃料切れ中、maxSpeedに対してこの割合まで速度を出せる（旋回は制限なし）
};

export interface Boid {
  id: number;
  pos: Vec2; // 絶対位置（perception層の外には渡さない）
  heading: number; // 向き（ラジアン）。旋回に上限はなく、毎tick自由に変えられる
  speed: number; // 速さ。0〜PHYSICS.maxSpeed。実際の移動ベクトルはheading/speedから導出する
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

export interface HeavyResource {
  id: number;
  pos: Vec2;
  requiredCarriers: number; // このboid数以上が同時にCARRY_RADIUS内でcarry:trueにしないと動かない
}

// interactRadius(8)はmaxSpeed(1)に対して狭く、資源を押して動かした直後に
// そのboid自身がinteractRadius外へ出てしまい、次tickに「離れすぎた」と
// 判定されて押すのをやめてしまう境界振動が起きる（headless検証で発見）。
// 協調搬送中の結合判定だけは、この振動が起きない程度に余裕を持たせた
// 専用の半径を使う。
export const CARRY_RADIUS = 20;

export interface World {
  width: number;
  height: number;
  tick: number;
  boids: Boid[];
  resources: ResourceNode[];
  bases: Base[];
  stations: Station[]; // 建設され増減する補給所。bases/resourcesと違い実行中に増える
  heavyResources: HeavyResource[]; // 複数boidの協調搬送でのみ動く資源
  stored: number; // 拠点・補給所を問わず搬入(drop)された資源の合計。グローバルに管理する
  terrain?: Terrain; // 地形。ないシナリオではundefined（frontDistは常にInfinityになる）
}

let nextId = 0;
const freshId = (): number => nextId++;

// 既定は燃料無制限。行動範囲を制限したいシナリオだけ
// PHYSICS.maxFuel などの有限値を明示的に渡す。
export function createBoid(pos: Vec2, heading: number = 0, fuel: number = Infinity): Boid {
  return {
    id: freshId(),
    pos,
    heading,
    speed: 0,
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

export function createHeavyResource(pos: Vec2, requiredCarriers: number): HeavyResource {
  return { id: freshId(), pos, requiredCarriers };
}

export function createWorld(width: number, height: number): World {
  return { width, height, tick: 0, boids: [], resources: [], bases: [], stations: [], heavyResources: [], stored: 0 };
}
