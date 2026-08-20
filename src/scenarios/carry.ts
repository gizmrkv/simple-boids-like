import { carryProgram } from '../programs/carry';
import type { Scenario } from '../scenario';
import { createBase, createBoid, createHeavyResource, createWorld } from '../world';

const WIDTH = 500;
const HEIGHT = 350;
const BOID_COUNT = 6;
// 資源requiredCarriers=2のペアがboid数の半分(3組)しか同時には組めないのに対し
// 資源を4個にすることで、単純な最寄り選択だと1体だけの資源が生じて詰む状況を
// 意図的に作る（ユーザーの提案）。全て届けるには、先に届け終えたペアが手の空いた
// 資源へ合流し直す必要がある。
const HEAVY_COUNT = 4;
const WIN_AMOUNT = HEAVY_COUNT;
const MAX_TICKS = 60 * 150; // 初期値。headless実行の結果を見て調整する

// boidのspawn・資源配置とも、拠点中心からviewRadius(60)に収まる範囲でランダム化
// する。「協調搬送」というメカニクス自体の検証が目的で、探索の難しさは別の
// シナリオ(frontier.ts)で既に検証済みのため、ここでは混ぜない、という方針は
// ランダム化後も維持する（worst caseでも資源とspawn円の最遠点がviewRadius内に
// 収まるよう、資源距離とspawn半径の上限を選んでいる）。
const BOID_SPAWN_RADIUS_MIN = 8;
const BOID_SPAWN_RADIUS_MAX = 14;
const RESOURCE_DIST_MIN = 30;
const RESOURCE_DIST_MAX = 42;

export const carryScenario: Scenario = {
  id: 'carry',
  name: '5. 協調搬送',
  description: `2体同時でないと動かせない資源(requiredCarriers=2)が${HEAVY_COUNT}個。boid${BOID_COUNT}体では同時に${Math.floor(BOID_COUNT / 2)}組しか組めないため、全${WIN_AMOUNT}個の搬入には合流先の交渉が必要。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    const center = { x: WIDTH / 2, y: HEIGHT / 2 };
    world.bases.push(createBase(center));

    for (let i = 0; i < HEAVY_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = RESOURCE_DIST_MIN + Math.random() * (RESOURCE_DIST_MAX - RESOURCE_DIST_MIN);
      world.heavyResources.push(
        createHeavyResource({ x: center.x + Math.cos(angle) * dist, y: center.y + Math.sin(angle) * dist }, 2),
      );
    }

    // 2体ずつ固定ペア(小隊)を組ませ、programs/carry.tsのcohesion/separationが
    // 機能するようmemory[4]に小隊idを書き込む(プログラム側は読むだけ)。
    for (let i = 0; i < BOID_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = BOID_SPAWN_RADIUS_MIN + Math.random() * (BOID_SPAWN_RADIUS_MAX - BOID_SPAWN_RADIUS_MIN);
      const boid = createBoid({ x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r });
      boid.memory[4] = Math.floor(i / 2);
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
