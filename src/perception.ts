import type { Vec2 } from './vec2';
import { fromPolar, length, rotate, sub, zero } from './vec2';
import type { Boid, World } from './world';
import { PHYSICS } from './world';
import { raycast } from './terrain/types';

export type NeighborKind = 'boid' | 'resource' | 'base' | 'station' | 'heavy';

export interface NeighborView {
  kind: NeighborKind;
  // 知覚元boidの現在のheadingを基準としたローカル座標系での相対位置
  // （+xが常に「自分の正面」）。boidは自分の絶対headingを知らないので、
  // ここでの座標がboidにとっての唯一の方向の基準になる。
  relPos: Vec2;
  relVel: Vec2; // 同じくローカル座標系での相対速度（資源・拠点は静止している）
  amount?: number; // resource: 残量
  requiredCarriers?: number; // kind === 'heavy' のときだけ、協調搬送に必要な人数
  cargo?: number; // kind === 'boid' のときだけ、荷物を運んでいるか（外から見てわかる情報として）
  memory?: readonly number[]; // kind === 'boid' のときだけ、読み取り専用スナップショット
  // kind === 'boid' または 'heavy' のときだけ設定。cargoと同じく固定・観測可能な
  // 属性で、絶対位置の情報は一切含まない。役割分担（リーダー選出など）や、
  // memoryのブロードキャストで「どの対象について言っているか」を照合するのに
  // 使える狭い追加情報——memoryのように毎tick手動でブロードキャストする必要はない。
  id?: number;
  // kind === 'station' のときだけ設定。station.pos - 拠点.pos を「今」計算した値
  // （stationオブジェクト自体には持たせない）。知覚元boidの位置にもheadingにも
  // 依存しない、拠点を基準にしたインフラ同士の相対位置なので、他のrelPosと違い
  // 回転させない（回転させると「同じstationなのにboidごとに値が変わる」という、
  // 拠点基準の情報としての意味が崩れてしまう）。単一拠点前提(world.bases[0])で計算。
  relBase?: Vec2;
}

export interface SelfView {
  id: number; // 自分自身のID（役割分担などに使える。絶対位置の情報は含まない）
  speed: number; // 自分の速さ（0〜PHYSICS.maxSpeed）。向きは常に「自分の正面」なので公開しない
  cargo: number;
  fuel: number; // 残燃料
  memory: number[]; // 書き換え可能なコピー。simulateがtick後にboidへ書き戻す
  // 自分の正面(heading方向)に地形までのLIDAR風レイキャストをした距離。
  // 地形のないシナリオ、または範囲内に障害物がない場合はInfinity。
  frontDist: number;
}

export interface WorldView {
  tick: number;
  width: number;
  height: number;
}

export interface Action {
  turn: number; // 今tickでheadingに加える回転角（ラジアン）。上限なし
  speed: number; // 次tickの速さ。PHYSICS.maxSpeedでクランプされる
  harvest?: boolean; // interactRadius内の資源から採取を試みる
  drop?: boolean; // interactRadius内の拠点へ搬入を試みる
  handoff?: boolean; // interactRadius内の空荷の他boidへ荷物を手渡す（リレー用）
  build?: boolean; // maxLineLength内に拠点/補給所があれば新しい補給所を建設する（コストなし）
  carry?: boolean; // interactRadius内の重量資源(heavy)を一緒に運ぼうとする意思表示
}

export type Program = (self: SelfView, neighbors: NeighborView[], world: WorldView) => Action;

export function buildSelfView(boid: Boid, world: World): SelfView {
  const frontDist = world.terrain ? raycast(world.terrain, boid.pos, boid.heading, PHYSICS.viewRadius) : Infinity;
  return { id: boid.id, speed: boid.speed, cargo: boid.cargo, fuel: boid.fuel, memory: [...boid.memory], frontDist };
}

export function buildWorldView(world: World): WorldView {
  return { tick: world.tick, width: world.width, height: world.height };
}

export function buildNeighbors(boid: Boid, world: World): NeighborView[] {
  const neighbors: NeighborView[] = [];
  const r = PHYSICS.viewRadius;
  const boidVel = fromPolar(boid.heading, boid.speed);
  const toLocal = (worldVec: Vec2): Vec2 => rotate(worldVec, -boid.heading);

  for (const other of world.boids) {
    if (other.id === boid.id) continue;
    const relPos = sub(other.pos, boid.pos);
    if (length(relPos) > r) continue;
    const otherVel = fromPolar(other.heading, other.speed);
    neighbors.push({
      kind: 'boid',
      relPos: toLocal(relPos),
      relVel: toLocal(sub(otherVel, boidVel)),
      cargo: other.cargo,
      memory: other.memory,
      id: other.id,
    });
  }

  for (const res of world.resources) {
    const relPos = sub(res.pos, boid.pos);
    if (length(relPos) > r) continue;
    neighbors.push({ kind: 'resource', relPos: toLocal(relPos), relVel: toLocal(sub(zero(), boidVel)), amount: res.amount });
  }

  for (const base of world.bases) {
    const relPos = sub(base.pos, boid.pos);
    if (length(relPos) > r) continue;
    neighbors.push({ kind: 'base', relPos: toLocal(relPos), relVel: toLocal(sub(zero(), boidVel)) });
  }

  for (const hr of world.heavyResources) {
    const relPos = sub(hr.pos, boid.pos);
    if (length(relPos) > r) continue;
    neighbors.push({
      kind: 'heavy',
      relPos: toLocal(relPos),
      relVel: toLocal(sub(zero(), boidVel)),
      id: hr.id,
      requiredCarriers: hr.requiredCarriers,
    });
  }

  const homeBase = world.bases[0]; // 単一拠点前提（既存シナリオは全て拠点1つ）
  for (const station of world.stations) {
    const relPos = sub(station.pos, boid.pos);
    if (length(relPos) > r) continue;
    neighbors.push({
      kind: 'station',
      relPos: toLocal(relPos),
      relVel: toLocal(sub(zero(), boidVel)),
      relBase: homeBase ? sub(station.pos, homeBase.pos) : undefined,
    });
  }

  return neighbors;
}
