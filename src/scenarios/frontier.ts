import { frontierProgram } from '../programs/frontier';
import type { Scenario } from '../scenario';
import { length, sub } from '../vec2';
import { createBase, createBoid, createResource, createWorld, PHYSICS } from '../world';

const WIDTH = 1600;
const HEIGHT = 1600;
const BOID_COUNT = 20;
const WIN_AMOUNT = 5;
const MAX_TICKS = 60 * 3000; // 初期値。headless実行の結果を見て調整する

const BASE_POS = { x: WIDTH / 2, y: HEIGHT / 2 };
// spawn位置を拠点周囲の円盤状にランダム分散させる半径。viewRadius(60)より
// 内側に収め、spawn直後は互いや拠点が視界に入りやすくする
// （分離力で拡散が始まるための初期条件、詳細はprograms/frontier.ts参照）。
const SPAWN_RADIUS = 40;
const PATCH_COUNT = 4;
// 各資源パッチの位置はランダムな角度・拠点からの距離約maxFuel*2でそれぞれ独立に
// 決める。distanceをmaxFuel超にすることで「補給所なしでは片道すら届かない」を
// 保証し、ラダー建設を必須にする（既存シナリオの「片道は届くが往復はできない」
// より厳しい）。4箇所は互いの位置を考慮せず独立に決めるため、稀に近接すること
// もあるが許容する。
function pickPatchCenter(): { x: number; y: number } {
  const angle = Math.random() * Math.PI * 2;
  const dist = PHYSICS.maxFuel * 2 + (Math.random() - 0.5) * 100;
  return { x: BASE_POS.x + Math.cos(angle) * dist, y: BASE_POS.y + Math.sin(angle) * dist };
}

export const frontierScenario: Scenario = {
  id: 'frontier',
  name: '6. 広域探索（実験）',
  description: `拠点(青)から補給所(紫)を建てながら分散探索し、方向不明の資源パッチ(緑)を${PATCH_COUNT}箇所のうちどれか見つけて${WIN_AMOUNT}個搬入したら成功。フェロモンなし版の実験。`,
  createWorld: () => {
    const world = createWorld(WIDTH, HEIGHT);
    world.bases.push(createBase(BASE_POS));

    for (let p = 0; p < PATCH_COUNT; p++) {
      const patchCenter = pickPatchCenter();
      for (let i = 0; i < 4; i++) {
        world.resources.push(
          createResource(
            { x: patchCenter.x + (Math.random() - 0.5) * 50, y: patchCenter.y + (Math.random() - 0.5) * 50 },
            6,
          ),
        );
      }
    }

    for (let i = 0; i < BOID_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * SPAWN_RADIUS; // 円盤内に一様分布させるための平方根補正
      const boid = createBoid(
        { x: BASE_POS.x + Math.cos(angle) * r, y: BASE_POS.y + Math.sin(angle) * r },
        undefined,
        PHYSICS.maxFuel,
      );
      world.boids.push(boid);
    }
    return world;
  },
  program: frontierProgram,
  checkWin: (world) => {
    const base = world.bases[0];
    const stored =
      world.bases.reduce((sum, b) => sum + b.stored, 0) + world.stations.reduce((sum, s) => sum + s.stored, 0);
    const farthest = world.stations.reduce((max, s) => Math.max(max, length(sub(s.pos, base.pos))), 0);
    const stats = `station数 ${world.stations.length}, 到達距離 ${farthest.toFixed(0)}`;
    if (stored >= WIN_AMOUNT) return { won: true, detail: `搬入完了: ${stored} (${stats})` };
    if (world.tick >= MAX_TICKS) return { won: false, detail: `時間切れ: ${stored}/${WIN_AMOUNT} (${stats})` };
    return { won: false, detail: `探索中: ${stored}/${WIN_AMOUNT} (${stats}, tick ${world.tick})` };
  },
};
