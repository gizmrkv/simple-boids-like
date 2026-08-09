import { relayProgram } from '../programs/relay';
import type { Scenario } from '../scenario';
import { createBase, createBoid, createResource, createWorld, PHYSICS } from '../world';

const WIDTH = 320;
const HEIGHT = 200;
const BOID_COUNT = 12;
const WIN_AMOUNT = 4;
const MAX_TICKS = 60 * 90; // 90秒

const BASE_POS = { x: 40, y: HEIGHT / 2 };
// 距離は「片道は燃料内で届くが、往復は燃料を超える」ように設定する。
// 燃料は拠点でしか補給できないため、距離が片道の燃料上限すら超えると
// 誰も資源にたどり着けず、原理的に解けなくなってしまう。
const RESOURCE_DISTANCE = PHYSICS.maxFuel * 0.65; // 往復(×2)は燃料を超えるが、片道は余裕を持って届く
const RESOURCE_POS = { x: BASE_POS.x + RESOURCE_DISTANCE, y: HEIGHT / 2 };

export const relayScenario: Scenario = {
  id: 'relay',
  name: '3. 中継リレー輸送',
  description: `拠点と資源の距離(${RESOURCE_POS.x - BASE_POS.x})は片道なら燃料で届くが、往復はできない。手渡しリレーが必要。`,
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
  program: relayProgram,
  checkWin: (world) => {
    const stored = world.bases.reduce((sum, b) => sum + b.stored, 0);
    if (stored >= WIN_AMOUNT) return { won: true, detail: `搬入完了: ${stored}` };
    if (world.tick >= MAX_TICKS) return { won: false, detail: `時間切れ: ${stored}/${WIN_AMOUNT}` };
    return { won: false, detail: `搬入中: ${stored}/${WIN_AMOUNT} (tick ${world.tick})` };
  },
};
