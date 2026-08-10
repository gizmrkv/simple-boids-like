import { supplyLineProgram } from '../programs/supply-line';
import type { Scenario } from '../scenario';
import { length, sub } from '../vec2';
import { createBase, createBoid, createResource, createWorld, PHYSICS } from '../world';

const WIDTH = 600;
const HEIGHT = 200;
const BOID_COUNT = 12;
const WIN_AMOUNT = 6;
// ラダー建設(数百tick、ladder.tsは同程度の距離で~400tick)＋複数回の往復輸送を
// 見込んだ第一稿の予算。ヘッドレス実行で実測して調整する前提の概算値。
const MAX_TICKS = 60 * 300; // 5分相当

const BASE_POS = { x: 40, y: HEIGHT / 2 };
// 燃料上限(maxFuel)すら超える距離に資源を置き、ラダー（中継補給）を使わない
// 限りそもそも到達不可能にする。「ラダーを設置した後に資源を回収」という
// フェーズ分離を明確にするため。
const RESOURCE_DISTANCE = PHYSICS.maxFuel * 1.15;
const RESOURCE_POS = { x: BASE_POS.x + RESOURCE_DISTANCE, y: HEIGHT / 2 };

export const supplyLineScenario: Scenario = {
  id: 'supply-line',
  name: '5. 補給線輸送',
  description: `拠点(青)から補給所(紫)のラダーを伸ばし、燃料だけでは届かない資源(緑)を回収して${WIN_AMOUNT}個搬入したら成功。搬入先は拠点・補給所のどちらでもよい。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    world.bases.push(createBase(BASE_POS));
    world.resources.push(createResource(RESOURCE_POS, 20));
    for (let i = 0; i < BOID_COUNT; i++) {
      world.boids.push(
        createBoid(
          { x: BASE_POS.x + (Math.random() - 0.5) * 10, y: BASE_POS.y + (Math.random() - 0.5) * 10 },
          undefined,
          PHYSICS.maxFuel,
        ),
      );
    }
    return world;
  },
  program: supplyLineProgram,
  checkWin: (world) => {
    const base = world.bases[0];
    const stored =
      world.bases.reduce((sum, b) => sum + b.stored, 0) + world.stations.reduce((sum, s) => sum + s.stored, 0);
    const farthest = world.stations.reduce((max, s) => Math.max(max, length(sub(s.pos, base.pos))), 0);
    const stats = `station数 ${world.stations.length}, 到達距離 ${farthest.toFixed(0)}`;
    if (stored >= WIN_AMOUNT) return { won: true, detail: `搬入完了: ${stored} (${stats})` };
    if (world.tick >= MAX_TICKS) return { won: false, detail: `時間切れ: ${stored}/${WIN_AMOUNT} (${stats})` };
    return { won: false, detail: `輸送中: ${stored}/${WIN_AMOUNT} (${stats}, tick ${world.tick})` };
  },
};
