import { gatherProgram } from '../programs/gather';
import type { Scenario } from '../scenario';
import { createBase, createBoid, createResource, createWorld } from '../world';

const WIDTH = 500;
const HEIGHT = 350;
const WIN_AMOUNT = 8;
const MAX_TICKS = 60 * 45; // 45秒 @ 60fps相当

export const gatherScenario: Scenario = {
  id: 'gather',
  name: '1. 収集・搬入',
  description: `資源(緑)を見つけて拠点(青)まで運ぶ。${WIN_AMOUNT}個搬入で成功。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    world.bases.push(createBase({ x: WIDTH / 2, y: HEIGHT / 2 }));
    world.resources.push(
      createResource({ x: WIDTH / 2 - 120, y: HEIGHT / 2 - 60 }, 6),
      createResource({ x: WIDTH / 2 + 130, y: HEIGHT / 2 + 40 }, 6),
      createResource({ x: WIDTH / 2 + 40, y: HEIGHT / 2 - 130 }, 6),
    );
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      world.boids.push(
        createBoid({
          x: WIDTH / 2 + Math.cos(angle) * 12,
          y: HEIGHT / 2 + Math.sin(angle) * 12,
        }),
      );
    }
    return world;
  },
  program: gatherProgram,
  checkWin: (world) => {
    const stored = world.bases.reduce((sum, b) => sum + b.stored, 0);
    if (stored >= WIN_AMOUNT) return { won: true, detail: `搬入完了: ${stored}` };
    if (world.tick >= MAX_TICKS) return { won: false, detail: `時間切れ: ${stored}/${WIN_AMOUNT}` };
    return { won: false, detail: `搬入中: ${stored}/${WIN_AMOUNT} (tick ${world.tick})` };
  },
};
