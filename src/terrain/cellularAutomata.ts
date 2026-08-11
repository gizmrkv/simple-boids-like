import type { Vec2 } from '../vec2';
import type { Terrain } from './types';

export interface CellularAutomataConfig {
  width: number;
  height: number;
  cellSize: number;
  fillProbability: number; // 初期ランダム充填率（壁になる確率）
  iterations: number; // 平滑化（多数決）の反復回数
  birthLimit: number; // 床のマスがこの数を超える壁隣接で壁化する閾値
  deathLimit: number; // 壁のマスがこの数未満の壁隣接で床化する閾値
  keepOpenAround?: { pos: Vec2; radius: number }[]; // 生成後、強制的に床にする領域（拠点周辺の詰み防止）
}

/**
 * セルオートマトンによる洞窟状地形の生成（RogueBasinの手法に準拠: 初期ランダム
 * 充填→近傍8マスの壁カウントによる多数決を反復）。境界セルは常に壁にして
 * ワールド境界と自然になじませる。
 */
export function generateCellularAutomataTerrain(config: CellularAutomataConfig): Terrain {
  const { width, height, cellSize, fillProbability, iterations, birthLimit, deathLimit, keepOpenAround } = config;
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);

  let grid: boolean[][] = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => (isBorder(x, y, cols, rows) ? true : Math.random() < fillProbability)),
  );

  for (let i = 0; i < iterations; i++) {
    grid = step(grid, cols, rows, birthLimit, deathLimit);
  }
  removeDiagonalPinches(grid, cols, rows);

  for (const { pos, radius } of keepOpenAround ?? []) {
    const cx = Math.floor(pos.x / cellSize);
    const cy = Math.floor(pos.y / cellSize);
    const r = Math.ceil(radius / cellSize);
    for (let y = Math.max(0, cy - r); y <= Math.min(rows - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(cols - 1, cx + r); x++) {
        if (Math.hypot((x - cx) * cellSize, (y - cy) * cellSize) <= radius) grid[y][x] = false;
      }
    }
  }

  return {
    isBlocked(p: Vec2): boolean {
      const x = Math.floor(p.x / cellSize);
      const y = Math.floor(p.y / cellSize);
      if (x < 0 || x >= cols || y < 0 || y >= rows) return false; // ワールド境界の衝突はbounceOffWallsの責務
      return grid[y][x];
    },
  };
}

/**
 * 2x2ブロックの対角上に壁マスが2つ、もう一方の対角に床マスが2つ並ぶ「対角ピンチ」
 * （幅0の隙間しかないのに、点ベースのisBlocked判定では通り抜けられてしまう形状）
 * を解消する。片方の壁マスを床にして幅1マス以上の通路に広げる（到達可能な面積を
 * 減らすことはない）。放置すると、raycastですり抜けて入り込んだ袋小路から
 * 単純な反応的回避では二度と出られなくなる。
 */
function removeDiagonalPinches(grid: boolean[][], cols: number, rows: number): void {
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols - 1; x++) {
      const tl = grid[y][x];
      const tr = grid[y][x + 1];
      const bl = grid[y + 1][x];
      const br = grid[y + 1][x + 1];
      if (tl && br && !tr && !bl) grid[y][x] = false;
      else if (tr && bl && !tl && !br) grid[y][x + 1] = false;
    }
  }
}

const isBorder = (x: number, y: number, cols: number, rows: number): boolean =>
  x === 0 || y === 0 || x === cols - 1 || y === rows - 1;

function step(grid: boolean[][], cols: number, rows: number, birthLimit: number, deathLimit: number): boolean[][] {
  return grid.map((row, y) =>
    row.map((cell, x) => {
      const wallCount = countWallNeighbors(grid, x, y, cols, rows);
      return cell ? wallCount >= deathLimit : wallCount > birthLimit;
    }),
  );
}

function countWallNeighbors(grid: boolean[][], x: number, y: number, cols: number, rows: number): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      // グリッド範囲外は壁として扱う（洞窟が外に開かないようにする）
      count += nx < 0 || nx >= cols || ny < 0 || ny >= rows ? 1 : grid[ny][nx] ? 1 : 0;
    }
  }
  return count;
}
