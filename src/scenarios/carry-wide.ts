import { carryProgram } from '../programs/carry';
import type { Scenario } from '../scenario';
import { createBase, createBoid, createHeavyResource, createWorld } from '../world';

// 【既知の制約】carryProgram(小隊の結合＋分離＋直進バイアス)は、この規模
// (資源20個・1200x800・boid6体)ではheadless実行でも全数搬入まで安定して
// 到達しない。90000tickでの試行(6回)では2〜10個で頭打ちになることが多く、
// 中央値は10個未満だった。3小隊しかいない探索単位が広いマップを覆いきれない
// ことが主因と見られる（局所的なフリーズ・デッドロックではなく、実際にcarry
// し続けている＝正しく動作した上での探索効率の限界であることをheadless検証
// で確認済み）。ユーザーが「もっと難しいバージョンを見たい」という発案で
// 追加したシナリオであり、既定のcarryProgramで必ず20個クリアできることは
// 意図的に保証していない——より賢い探索・交渉ロジックを書けるかという
// パズルとして提示している。

const WIDTH = 1200;
const HEIGHT = 800;
const BOID_COUNT = 6;
const SQUAD_SIZE = 2; // 資源のrequiredCarriers(2)と同数=1小隊がそのままペアになる
const HEAVY_COUNT = 20;
const WIN_AMOUNT = HEAVY_COUNT;
// frontier.ts(広域探索)と同規模。この規模の探索はheadless実行でも
// 20個全部の搬入まで安定して届かないことがある(下記の既知の制約を参照)ため、
// 時間切れによる打ち切りをできるだけ避ける方向で大きめに取っている。
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
