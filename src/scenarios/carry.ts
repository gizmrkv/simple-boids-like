import { carryProgram } from '../programs/carry';
import type { Scenario } from '../scenario';
import { createBase, createBoid, createHeavyResource, createWorld } from '../world';

const WIDTH = 500;
const HEIGHT = 350;
const WIN_AMOUNT = 2;
const MAX_TICKS = 60 * 90; // 90秒 @ 60fps相当

export const carryScenario: Scenario = {
  id: 'carry',
  name: '5. 協調搬送',
  description: `2体同時でないと動かせない資源(requiredCarriers=2)を拠点まで運ぶ。${WIN_AMOUNT}個搬入で成功。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    world.bases.push(createBase({ x: WIDTH / 2, y: HEIGHT / 2 }));
    // 拠点付近のboid(半径12でスポーン)からviewRadius(60)内に収まる距離に置く。
    // 「協調搬送」というメカニクス自体の検証が目的で、探索の難しさは別の
    // シナリオ(frontier.ts)で既に検証済みのため、ここでは混ぜない。
    world.heavyResources.push(
      createHeavyResource({ x: WIDTH / 2 - 45, y: HEIGHT / 2 }, 2),
      createHeavyResource({ x: WIDTH / 2 + 45, y: HEIGHT / 2 }, 2),
    );
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      world.boids.push(
        createBoid({ x: WIDTH / 2 + Math.cos(angle) * 12, y: HEIGHT / 2 + Math.sin(angle) * 12 }),
      );
    }
    return world;
  },
  program: carryProgram,
  checkWin: (world) => {
    const stored = world.stored;
    if (stored >= WIN_AMOUNT) return { won: true, detail: `搬入完了: ${stored}` };
    if (world.tick >= MAX_TICKS) return { won: false, detail: `時間切れ: ${stored}/${WIN_AMOUNT}` };
    return { won: false, detail: `搬送中: ${stored}/${WIN_AMOUNT} (tick ${world.tick})` };
  },
};
