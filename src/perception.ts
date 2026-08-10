import type { Vec2 } from './vec2';
import { length, sub, zero } from './vec2';
import type { Boid, World } from './world';
import { PHYSICS } from './world';

export type NeighborKind = 'boid' | 'resource' | 'base' | 'station';

export interface NeighborView {
  kind: NeighborKind;
  relPos: Vec2; // 知覚元boidを原点とした相対位置
  relVel: Vec2; // 相対速度（資源・拠点は静止しているので -selfVel）
  amount?: number; // resource: 残量
  cargo?: number; // kind === 'boid' のときだけ、荷物を運んでいるか（外から見てわかる情報として）
  memory?: readonly number[]; // kind === 'boid' のときだけ、読み取り専用スナップショット
  // kind === 'boid' のときだけ設定。cargoと同じく固定・観測可能な属性で、絶対位置の
  // 情報は一切含まない。役割分担（リーダー選出など）に使える狭い追加情報——memoryの
  // ように毎tick手動でブロードキャストする必要はない。
  id?: number;
  // kind === 'station' のときだけ設定。station.pos - 拠点.pos を「今」計算した値
  // （stationオブジェクト自体には持たせない）。boid自身の絶対位置は依然として
  // 一切渡さないが、既知のインフラ(station)については拠点からの相対位置という
  // 形で真の情報を渡す、狭く意図的な例外。単一拠点前提(world.bases[0])で計算。
  relBase?: Vec2;
}

export interface SelfView {
  id: number; // 自分自身のID（役割分担などに使える。絶対位置の情報は含まない）
  vel: Readonly<Vec2>; // 自分の絶対速度（絶対位置は渡さない）
  cargo: number;
  fuel: number; // 残燃料
  memory: number[]; // 書き換え可能なコピー。simulateがtick後にboidへ書き戻す
}

export interface WorldView {
  tick: number;
  width: number;
  height: number;
}

export interface Action {
  vel: Vec2; // 次tickの速度ベクトル。大きさはPHYSICS.maxSpeedでクランプされる
  harvest?: boolean; // interactRadius内の資源から採取を試みる
  drop?: boolean; // interactRadius内の拠点へ搬入を試みる
  handoff?: boolean; // interactRadius内の空荷の他boidへ荷物を手渡す（リレー用）
  build?: boolean; // maxLineLength内に拠点/補給所があれば新しい補給所を建設する（コストなし）
}

export type Program = (self: SelfView, neighbors: NeighborView[], world: WorldView) => Action;

export function buildSelfView(boid: Boid): SelfView {
  return { id: boid.id, vel: boid.vel, cargo: boid.cargo, fuel: boid.fuel, memory: [...boid.memory] };
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
      cargo: other.cargo,
      memory: other.memory,
      id: other.id,
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
    neighbors.push({ kind: 'base', relPos, relVel: sub(zero(), boid.vel) });
  }

  const homeBase = world.bases[0]; // 単一拠点前提（既存シナリオは全て拠点1つ）
  for (const station of world.stations) {
    const relPos = sub(station.pos, boid.pos);
    if (length(relPos) > r) continue;
    neighbors.push({
      kind: 'station',
      relPos,
      relVel: sub(zero(), boid.vel),
      relBase: homeBase ? sub(station.pos, homeBase.pos) : undefined,
    });
  }

  return neighbors;
}
