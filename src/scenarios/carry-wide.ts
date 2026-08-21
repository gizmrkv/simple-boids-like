import { carryProgram } from '../programs/carry';
import type { Scenario } from '../scenario';
import { createBase, createBoid, createHeavyResource, createWorld } from '../world';

// 当初はcarryProgram(小隊の結合＋分離＋直進バイアス)がこの規模(資源20個・
// 1200x800・boid6体)ではheadless実行でも全数搬入まで安定して到達せず(90000
// tickでの試行6回で中央値10個未満)、探索単位(3小隊)が広いマップを覆い
// きれない探索効率の限界と見られていた。しかし実際の主因は別にあった:
// dead reckoning(memory[0..1])が壁反射(bounceOffWalls)後にズレたまま
// 戻らない不具合(simulate.tsのapplyDeadReckoningで修正、詳細はroadmap.md
// 参照)により、壁際まで探索したboidが正しく帰還できずにいた。修正後は
// headless 6回中6回とも20/20搬入を達成(tick 12749〜18658)。

const WIDTH = 1200;
const HEIGHT = 800;
const BOID_COUNT = 6;
const SQUAD_SIZE = 2; // 資源のrequiredCarriers(2)と同数=1小隊がそのままペアになる
const HEAVY_COUNT = 20;
const WIN_AMOUNT = HEAVY_COUNT;
// frontier.ts(広域探索)と同規模。dead reckoning修正後の実測(headless 6回)では
// 12749〜18658tickで20個搬入が完了するが、余裕を持って大きめに取っている。
const MAX_TICKS = 60 * 3000;
const RESOURCE_MARGIN = 80; // マップ端からの最小距離（viewRadius(60)より少し広め）
const BOID_SPAWN_RADIUS_MIN = 8;
const BOID_SPAWN_RADIUS_MAX = 14;

export const carryWideScenario: Scenario = {
  id: 'carry-wide',
  name: '7. 広域協調搬送',
  description: `協調搬送(5)を大規模化: マップ全体に散らばった重量資源(requiredCarriers=2)が${HEAVY_COUNT}個。boid${BOID_COUNT}体(2体1組×3小隊)で全${WIN_AMOUNT}個の搬入を目指す。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    const center = { x: WIDTH / 2, y: HEIGHT / 2 };
    world.bases.push(createBase(center));

    for (let i = 0; i < HEAVY_COUNT; i++) {
      const x = RESOURCE_MARGIN + Math.random() * (WIDTH - 2 * RESOURCE_MARGIN);
      const y = RESOURCE_MARGIN + Math.random() * (HEIGHT - 2 * RESOURCE_MARGIN);
      world.heavyResources.push(createHeavyResource({ x, y }, 2));
    }

    // 2体ずつ固定ペア(小隊)を組ませ、programs/carry.tsのcohesion/separationが
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
