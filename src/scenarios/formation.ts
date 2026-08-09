import { formationProgram, TARGET_RADIUS } from '../programs/formation';
import type { Scenario } from '../scenario';
import { createBase, createBoid, createWorld } from '../world';

const WIDTH = 300;
const HEIGHT = 300;
const BOID_COUNT = 10;
const TOLERANCE = 8;
const WARMUP_TICKS = 60 * 8; // 8秒、収束するまでの猶予

export const formationScenario: Scenario = {
  id: 'formation',
  name: '2. 隊列・陣形維持',
  description: `局所ルールだけで拠点(青)の周りに半径${TARGET_RADIUS}のリング陣形を作って維持する。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    const center = { x: WIDTH / 2, y: HEIGHT / 2 };
    world.bases.push(createBase(center));
    for (let i = 0; i < BOID_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 15 + Math.random() * 20;
      world.boids.push(
        createBoid({ x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r }),
      );
    }
    return world;
  },
  program: formationProgram,
  checkWin: (world) => {
    const base = world.bases[0];
    const dists = world.boids.map((b) => Math.hypot(b.pos.x - base.pos.x, b.pos.y - base.pos.y));
    const inRing = dists.every((d) => Math.abs(d - TARGET_RADIUS) <= TOLERANCE);

    if (world.tick < WARMUP_TICKS) return { won: false, detail: `収束待ち (tick ${world.tick}/${WARMUP_TICKS})` };
    if (inRing) return { won: true, detail: `陣形維持成功 (tick ${world.tick})` };
    const maxErr = Math.max(...dists.map((d) => Math.abs(d - TARGET_RADIUS)));
    return { won: false, detail: `陣形が崩れている (最大誤差 ${maxErr.toFixed(1)})` };
  },
};
