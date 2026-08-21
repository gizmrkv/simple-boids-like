import { carryProgram } from '../programs/carry';
import type { Scenario } from '../scenario';
import { createBase, createBoid, createHeavyResource, createWorld } from '../world';

const WIDTH = 1600;
const HEIGHT = 1000;
const BOID_COUNT = 12;
const SQUAD_SIZE = 3; // 資源のrequiredCarriers(3)と同数=1小隊がそのまま合流単位になる
const HEAVY_COUNT = 24;
const WIN_AMOUNT = HEAVY_COUNT;
// headless 16回の試行では9149〜49140tickで24個搬入が完了しており、余裕を
// 持って大きめに取っている。
const MAX_TICKS = 60 * 1500;
const RESOURCE_MARGIN = 80; // マップ端からの最小距離（viewRadius(60)より少し広め）
const BOID_SPAWN_RADIUS_MIN = 8;
const BOID_SPAWN_RADIUS_MAX = 14;

export const carryTrioScenario: Scenario = {
  id: 'carry-trio',
  name: '8. 三体一組の大規模協調搬送',
  description: `広域協調搬送(7)をさらに拡大: requiredCarriers=3の重量資源が${HEAVY_COUNT}個。boid${BOID_COUNT}体(3体1組×4小隊)で全${WIN_AMOUNT}個の搬入を目指す。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    const center = { x: WIDTH / 2, y: HEIGHT / 2 };
    world.bases.push(createBase(center));

    for (let i = 0; i < HEAVY_COUNT; i++) {
      const x = RESOURCE_MARGIN + Math.random() * (WIDTH - 2 * RESOURCE_MARGIN);
      const y = RESOURCE_MARGIN + Math.random() * (HEIGHT - 2 * RESOURCE_MARGIN);
      world.heavyResources.push(createHeavyResource({ x, y }, 3));
    }

    // 3体ずつ固定小隊を組ませ、programs/carry.tsのcohesion/separationが
    // 機能するようmemory[4]に小隊idを書き込む(プログラム側は読むだけ)。
    for (let i = 0; i < BOID_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = BOID_SPAWN_RADIUS_MIN + Math.random() * (BOID_SPAWN_RADIUS_MAX - BOID_SPAWN_RADIUS_MIN);
      const boid = createBoid({ x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r });
      boid.memory[4] = Math.floor(i / SQUAD_SIZE);
      world.boids.push(boid);
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
