import type { Vec2 } from './vec2';
import { length, sub } from './vec2';
import type { World } from './world';
import { PHYSICS } from './world';

// stationは接続relationを持たない（意図的に最小限のまま）。線の描画は毎フレーム
// その時点の真の位置から導出するだけの見た目上の表現で、build時の実際の
// 接続関係を記憶しているわけではない（perception.tsのrelBaseと同じ考え方）。
//
// 「単純に一番近いアンカーへ線を引く」実装だと、近接して建った補給所同士が
// お互いを最寄りとして選び、拠点への本来の経路が無視されて孤立した断片に
// 見えてしまう問題があった（ヘッドレスではなくブラウザで実際に描画して初めて
// 気づいた）。代わりに拠点を起点にしたBFSで全域木を組む。補給所は建設時に
// 必ず既存のネットワーク(拠点かどこかの補給所)からmaxLineLength以内だった
// ことがsimulate.ts側で保証されているため、この帰納的な性質により現存する
// すべての補給所は拠点までmaxLineLengthごとの経路で連結可能なはずで、BFSなら
// 単純な最近傍探索と違って必ずその経路を見つけられる。
function supplyLineEdges(world: World): { from: Vec2; to: Vec2 }[] {
  const nodes: Vec2[] = [...world.bases.map((b) => b.pos), ...world.stations.map((s) => s.pos)];
  const visited = new Set<number>(world.bases.map((_, i) => i));
  const queue = [...visited];
  const edges: { from: Vec2; to: Vec2 }[] = [];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (let j = 0; j < nodes.length; j++) {
      if (visited.has(j)) continue;
      if (length(sub(nodes[j], nodes[cur])) <= PHYSICS.maxLineLength) {
        visited.add(j);
        queue.push(j);
        edges.push({ from: nodes[cur], to: nodes[j] });
      }
    }
  }

  return edges;
}

// 地形の可視化用サンプリング間隔。生成器のcellSizeとは独立でよい
// （TerrainインターフェースはisBlockedしか公開しないため、これで十分）。
const TERRAIN_SAMPLE_STEP = 5;

function drawTerrain(ctx: CanvasRenderingContext2D, world: World): void {
  if (!world.terrain) return;
  ctx.fillStyle = '#495057';
  for (let y = 0; y < world.height; y += TERRAIN_SAMPLE_STEP) {
    for (let x = 0; x < world.width; x += TERRAIN_SAMPLE_STEP) {
      if (world.terrain.isBlocked({ x, y })) {
        ctx.fillRect(x, y, TERRAIN_SAMPLE_STEP, TERRAIN_SAMPLE_STEP);
      }
    }
  }
}

export function render(ctx: CanvasRenderingContext2D, world: World, showViewRadius = false): void {
  ctx.clearRect(0, 0, world.width, world.height);
  drawTerrain(ctx, world);

  for (const base of world.bases) {
    ctx.fillStyle = '#4dabf7';
    ctx.fillRect(base.pos.x - 6, base.pos.y - 6, 12, 12);
  }

  ctx.strokeStyle = 'rgba(218, 119, 242, 0.35)';
  ctx.lineWidth = 2;
  for (const edge of supplyLineEdges(world)) {
    ctx.beginPath();
    ctx.moveTo(edge.from.x, edge.from.y);
    ctx.lineTo(edge.to.x, edge.to.y);
    ctx.stroke();
  }

  for (const station of world.stations) {
    ctx.beginPath();
    ctx.moveTo(station.pos.x, station.pos.y - 5);
    ctx.lineTo(station.pos.x + 5, station.pos.y);
    ctx.lineTo(station.pos.x, station.pos.y + 5);
    ctx.lineTo(station.pos.x - 5, station.pos.y);
    ctx.closePath();
    ctx.fillStyle = '#da77f2';
    ctx.fill();
  }

  for (const res of world.resources) {
    if (res.amount <= 0) continue;
    ctx.beginPath();
    ctx.arc(res.pos.x, res.pos.y, 4 + Math.min(res.amount, 10), 0, Math.PI * 2);
    ctx.fillStyle = '#69db7c';
    ctx.fill();
  }

  if (showViewRadius) {
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.2)';
    ctx.lineWidth = 1;
    for (const boid of world.boids) {
      ctx.beginPath();
      ctx.arc(boid.pos.x, boid.pos.y, PHYSICS.viewRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  for (const boid of world.boids) {
    ctx.save();
    ctx.translate(boid.pos.x, boid.pos.y);
    ctx.rotate(boid.heading);
    ctx.beginPath();
    ctx.moveTo(5, 0);
    ctx.lineTo(-4, 3);
    ctx.lineTo(-4, -3);
    ctx.closePath();
    ctx.fillStyle = boid.cargo > 0 ? '#ffd43b' : '#e9ecef';
    ctx.fill();
    if (boid.fuel < PHYSICS.maxFuel * 0.2) {
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }
}
