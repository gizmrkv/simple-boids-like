import { ladderProgram } from '../programs/ladder';
import type { Scenario } from '../scenario';
import { length, sub } from '../vec2';
import { createBase, createBoid, createWorld, PHYSICS } from '../world';

const WIDTH = 500;
const HEIGHT = 200;
const BOID_COUNT = 10;
const BASE_POS = { x: 40, y: HEIGHT / 2 };
// maxLineLengthより十分大きい距離を目標にすることで、1回の建設では届かず
// ラダー（複数回の建設の連鎖）が必要になるようにする。
const TARGET_DISTANCE = PHYSICS.maxFuel * 1.5;
const MAX_TICKS = 60 * 180; // 3分

export const ladderScenario: Scenario = {
  id: 'ladder',
  name: '4. 補給網拡張（ラダー）',
  description: `拠点(青)から補給所(紫)の連鎖を伸ばし、拠点からの距離が${TARGET_DISTANCE}に達したら成功。資源の搬入は問わない。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    world.bases.push(createBase(BASE_POS));
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
  program: ladderProgram,
  checkWin: (world) => {
    const base = world.bases[0];
    const farthest = world.stations.reduce((max, s) => Math.max(max, length(sub(s.pos, base.pos))), 0);
    if (farthest >= TARGET_DISTANCE) return { won: true, detail: `到達距離: ${farthest.toFixed(0)}/${TARGET_DISTANCE}` };
    if (world.tick >= MAX_TICKS) return { won: false, detail: `時間切れ: ${farthest.toFixed(0)}/${TARGET_DISTANCE}` };
    return {
      won: false,
      detail: `建設中: ${farthest.toFixed(0)}/${TARGET_DISTANCE} (station数 ${world.stations.length}, tick ${world.tick})`,
    };
  },
};
