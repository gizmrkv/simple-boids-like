import { relayProgram } from '../programs/relay';
import type { Scenario } from '../scenario';
import { createBase, createBoid, createResource, createWorld } from '../world';

const WIDTH = 700;
const HEIGHT = 200;
const BOID_COUNT = 12;
const WIN_AMOUNT = 4;
const MAX_TICKS = 60 * 90; // 90秒

const BASE_POS = { x: 60, y: HEIGHT / 2 };
const RESOURCE_POS = { x: WIDTH - 60, y: HEIGHT / 2 };

export const relayScenario: Scenario = {
  id: 'relay',
  name: '3. 中継リレー輸送',
  description: `拠点と資源の距離(${RESOURCE_POS.x - BASE_POS.x})が1boidの燃料範囲を超える。手渡しリレーが必要。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    world.bases.push(createBase(BASE_POS));
    world.resources.push(createResource(RESOURCE_POS, 20));
    for (let i = 0; i < BOID_COUNT; i++) {
      world.boids.push(
        createBoid({ x: BASE_POS.x + (Math.random() - 0.5) * 10, y: BASE_POS.y + (Math.random() - 0.5) * 10 }),
      );
    }
    return world;
  },
  program: relayProgram,
  checkWin: (world) => {
    const stored = world.bases.reduce((sum, b) => sum + b.stored, 0);
    if (stored >= WIN_AMOUNT) return { won: true, detail: `搬入完了: ${stored}` };
    if (world.tick >= MAX_TICKS) return { won: false, detail: `時間切れ: ${stored}/${WIN_AMOUNT}` };
    return { won: false, detail: `搬入中: ${stored}/${WIN_AMOUNT} (tick ${world.tick})` };
  },
};
