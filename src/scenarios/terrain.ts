import { terrainProgram } from '../programs/terrain';
import type { Scenario } from '../scenario';
import { generateCellularAutomataTerrain } from '../terrain/cellularAutomata';
import type { Terrain } from '../terrain/types';
import type { Vec2 } from '../vec2';
import { createBase, createBoid, createResource, createWorld, PHYSICS } from '../world';

const WIDTH = 1200;
const HEIGHT = 800;
const WIN_AMOUNT = 6;
const MAX_TICKS = 60 * 300; // 300秒 @ 60fps相当。マップが2倍になった分、旧シナリオより長め

// 拠点からの方向・距離の目安（旧600x400版のオフセットをおよそ2倍にしただけの目安値）。
// 実際の座標は地形生成後にfindOpenSpotで歩行可能な位置へ調整する。
const RESOURCE_TARGETS = (basePos: Vec2): Vec2[] => [
  { x: basePos.x - 400, y: basePos.y - 220 },
  { x: basePos.x + 400, y: basePos.y + 180 },
  { x: basePos.x + 140, y: basePos.y - 220 },
  { x: basePos.x - 300, y: basePos.y + 240 },
];

/**
 * 地形生成より前に資源座標を決め打ちすると、生成結果次第で資源が壁の中に
 * 埋まってしまう（到達不能になる以前に、そもそも「資源のある場所」自体が
 * 壁というおかしな状態になる）。地形を生成した後、targetを起点に半径を
 * 広げながらランダムな候補点を試し、歩行可能(`!isBlocked`)な位置が
 * 見つかるまでやり直す。
 */
function findOpenSpot(terrain: Terrain, target: Vec2, width: number, height: number): Vec2 {
  if (!terrain.isBlocked(target)) return target;
  for (let attempt = 0; attempt < 500; attempt++) {
    const radius = 40 + attempt * 2; // 見つからないほど探索範囲を広げる
    const candidate = {
      x: Math.min(width - 20, Math.max(20, target.x + (Math.random() * 2 - 1) * radius)),
      y: Math.min(height - 20, Math.max(20, target.y + (Math.random() * 2 - 1) * radius)),
    };
    if (!terrain.isBlocked(candidate)) return candidate;
  }
  return target; // 理論上ほぼ到達しない最後の手段
}

export const terrainScenario: Scenario = {
  id: 'terrain',
  name: '4. 地形回避（実験）',
  description: `セルオートマトン生成の洞窟地形(灰)を、前方のLIDAR風距離センサー(frontDist)だけで避けながら資源(緑)を運ぶ。${WIN_AMOUNT}個搬入で成功。地形の連結性は保証されないため、資源が到達不能なマップが生成されることもある。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    const basePos = { x: WIDTH / 2, y: HEIGHT / 2 };
    world.bases.push(createBase(basePos));

    // 拠点周辺(視界半径ぶん)は生成結果に関わらず必ず歩行可能にする。
    // それ以外の連結性(拠点から各資源まで到達できるか)は保証しない。
    world.terrain = generateCellularAutomataTerrain({
      width: WIDTH,
      height: HEIGHT,
      cellSize: 25,
      fillProbability: 0.35,
      iterations: 5,
      birthLimit: 4,
      deathLimit: 3,
      keepOpenAround: [{ pos: basePos, radius: PHYSICS.viewRadius }],
    });

    for (const target of RESOURCE_TARGETS(basePos)) {
      world.resources.push(createResource(findOpenSpot(world.terrain, target, WIDTH, HEIGHT), 6));
    }

    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      world.boids.push(
        createBoid(
          {
            x: basePos.x + Math.cos(angle) * 12,
            y: basePos.y + Math.sin(angle) * 12,
          },
          angle, // 初期headingも分散させる。全員が同じ向きだと壁沿い走行で同じ壁を辿ってしまう
          PHYSICS.maxFuel,
        ),
      );
    }
    return world;
  },
  program: terrainProgram,
  checkWin: (world) => {
    const stored = world.stored;
    if (stored >= WIN_AMOUNT) return { won: true, detail: `搬入完了: ${stored}` };
    if (world.tick >= MAX_TICKS) return { won: false, detail: `時間切れ: ${stored}/${WIN_AMOUNT}` };
    return { won: false, detail: `搬入中: ${stored}/${WIN_AMOUNT} (tick ${world.tick})` };
  },
};
