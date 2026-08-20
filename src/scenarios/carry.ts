import { carryProgram } from '../programs/carry';
import type { Scenario } from '../scenario';
import { createBase, createBoid, createHeavyResource, createWorld } from '../world';

const WIDTH = 500;
const HEIGHT = 350;
const BOID_COUNT = 6;
const WIN_AMOUNT = 2;
const MAX_TICKS = 60 * 90; // 90秒 @ 60fps相当

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
  description: `2体同時でないと動かせない資源(requiredCarriers=2)を拠点まで運ぶ。${WIN_AMOUNT}個搬入で成功。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    const center = { x: WIDTH / 2, y: HEIGHT / 2 };
    world.bases.push(createBase(center));

    for (let i = 0; i < WIN_AMOUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = RESOURCE_DIST_MIN + Math.random() * (RESOURCE_DIST_MAX - RESOURCE_DIST_MIN);
      world.heavyResources.push(
        createHeavyResource({ x: center.x + Math.cos(angle) * dist, y: center.y + Math.sin(angle) * dist }, 2),
      );
    }

    for (let i = 0; i < BOID_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = BOID_SPAWN_RADIUS_MIN + Math.random() * (BOID_SPAWN_RADIUS_MAX - BOID_SPAWN_RADIUS_MIN);
      world.boids.push(createBoid({ x: center.x + Math.cos(angle) * r, y: center.y + Math.sin(angle) * r }));
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
