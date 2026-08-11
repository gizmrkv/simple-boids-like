import { terrainProgram } from '../programs/terrain';
import type { Scenario } from '../scenario';
import { generateCellularAutomataTerrain } from '../terrain/cellularAutomata';
import { createBase, createBoid, createResource, createWorld, PHYSICS } from '../world';

const WIDTH = 600;
const HEIGHT = 400;
const WIN_AMOUNT = 6;
const MAX_TICKS = 60 * 150; // 150秒 @ 60fps相当。地形回避の分gather.tsより長め

export const terrainScenario: Scenario = {
  id: 'terrain',
  name: '4. 地形回避（実験）',
  description: `セルオートマトン生成の洞窟地形(灰)を、前方のLIDAR風距離センサー(frontDist)だけで避けながら資源(緑)を運ぶ。${WIN_AMOUNT}個搬入で成功。地形の連結性は保証されないため、資源が到達不能なマップが生成されることもある。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    const basePos = { x: WIDTH / 2, y: HEIGHT / 2 };
    world.bases.push(createBase(basePos));
    // 生成される地形は世界の端が必ず壁になる（セルオートマトンの境界処理）ため、
    // 資源は端から十分離して置く。端に近すぎるとboidが壁際の狭い隙間で
    // 資源のすぐ手前まで来ては阻まれる、という抜け出しにくい局所停滞に
    // 陥りやすいことがheadless検証で判明した。
    world.resources.push(
      createResource({ x: WIDTH / 2 - 200, y: HEIGHT / 2 - 110 }, 6),
      createResource({ x: WIDTH / 2 + 200, y: HEIGHT / 2 + 90 }, 6),
      createResource({ x: WIDTH / 2 + 70, y: HEIGHT / 2 - 110 }, 6),
      createResource({ x: WIDTH / 2 - 150, y: HEIGHT / 2 + 120 }, 6),
    );
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      world.boids.push(
        createBoid({
          x: basePos.x + Math.cos(angle) * 12,
          y: basePos.y + Math.sin(angle) * 12,
        }),
      );
    }
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
