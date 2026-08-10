import type { Program } from '../perception';
import { length, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest, isLocalMax } from './util';

const BUILD_MARGIN = 0.75; // ladder.ts/supply-line.tsと同じ値・同じ理由
const INTENT_SLOT = 2; // memory[2]: 建設意思表示（ladder.ts/supply-line.tsと同じ）
const BEARING_SLOT = 3; // memory[3]: この個体固有の探索方位（ラジアン）。scenario側が
// spawn時に1回だけ書き込み、プログラムは読むだけで書き換えない。

/**
 * ladder.ts + supply-line.tsの組み合わせから、EXPLORE_DIR/RETURN_DIRという
 * 「資源は拠点からこの方向にある」という決め打ちを取り除いたバージョン。
 * 広大なフィールドのどこにあるか分からない資源クラスタを、個体ごとに
 * 異なる固定方位へ分散することで探索する。
 *
 * 【往路：memory[BEARING_SLOT]の固定方位】
 * 資源の位置をプログラムは一切知らないため、探索方向を「資源のある方角」に
 * 向けることはそもそもできない。代わりに、scenario側がspawn時に各boidへ
 * 均等に分散した方位を1回だけ割り当てる（gather.tsのspawnリング配置と同じ
 * 考え方）。これは資源の実際の位置とは無相関の一般的な初期配置であり、
 * プログラムが絶対位置や資源の方向を知ることには一切ならない。
 *
 * 探索中はこの方位を毎tickそのまま使い、ノイズを加えたランダムウォークには
 * しない。dead reckoning（memory[0..1]）は直線的な動きを前提に距離を推定
 * しているため、方向が揺らぐと実際の変位より積算距離が小さく見積もられ、
 * 建設判断（wantsToBuild）が遅れて燃料切れのまま孤立するリスクがある
 * （ladder.ts/supply-line.tsでBUILD_MARGINを0.9から0.75まで下げた経緯と
 * 同種の問題）。
 *
 * 【復路：逆dead reckoning】
 * RETURN_DIRのような固定方向も存在しないため、cargo>0のときは
 * memory[0..1]（最後にアンカーに触れてからの推定変位）の符号を反転した
 * 方向へ進む。これは「自分が今まさに歩いてきた道を逆にたどる」動きになる。
 * 特定アンカーのrelPosを狙わない設計はsupply-line.tsを踏襲している——
 * 直前に自分で建てた補給所の真上にいる状況でrelPosを狙うと、1tickごとに
 * オーバーシュートして符号が反転し続け前進しなくなる不具合が過去に
 * 見つかっているため（詳細はsupply-line.tsのdocコメント参照）。
 *
 * 建設のリーダー選出（wasIntending + isLocalMax + nearVisibleAnchorガード）は
 * ladder.ts/supply-line.tsと全く同じ仕組みで、視界内の近傍集合と同tick内の
 * memory書き戻しの非対称性に基づく話であって特定の方向には依存しないため、
 * そのまま成立する（正しさの根拠はladder.tsのdocコメント参照）。
 */
export const frontierProgram: Program = (self, neighbors) => {
  const wasIntending = self.memory[INTENT_SLOT] === 1;

  self.memory[0] += self.vel.x;
  self.memory[1] += self.vel.y;

  const anchors = neighbors.filter((n) => n.kind === 'base' || n.kind === 'station');
  const atAnchor = anchors.length > 0 && length(closest(anchors).relPos) < PHYSICS.interactRadius;
  if (atAnchor) {
    self.memory[0] = 0;
    self.memory[1] = 0;
  }

  let steer = { x: Math.cos(self.memory[BEARING_SLOT]), y: Math.sin(self.memory[BEARING_SLOT]) };
  let harvest = false;
  let drop = false;

  if (self.cargo > 0) {
    const homeVec = { x: -self.memory[0], y: -self.memory[1] };
    steer = length(homeVec) > 0 ? normalize(homeVec) : zero();
    drop = anchors.length > 0 && length(closest(anchors).relPos) < PHYSICS.interactRadius;
  } else {
    const resources = neighbors.filter((n) => n.kind === 'resource' && (n.amount ?? 0) > 0);
    if (resources.length > 0) {
      const res = closest(resources);
      steer = normalize(res.relPos);
      harvest = length(res.relPos) < PHYSICS.interactRadius;
    }
  }

  const nearVisibleAnchor = anchors.some((a) => length(a.relPos) < PHYSICS.maxLineLength);
  const estDist = length({ x: self.memory[0], y: self.memory[1] });
  const wantsToBuild = self.cargo === 0 && !nearVisibleAnchor && estDist > PHYSICS.maxLineLength * BUILD_MARGIN;
  self.memory[INTENT_SLOT] = wantsToBuild ? 1 : 0;

  const intendingPeers = neighbors.filter((n) => n.kind === 'boid' && n.memory?.[INTENT_SLOT] === 1);
  const build = wantsToBuild && wasIntending && isLocalMax(self.id, intendingPeers);

  return { vel: scale(steer, PHYSICS.maxSpeed), harvest, drop, build };
};
