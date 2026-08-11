import type { Program } from '../perception';
import { length, normalize, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest, isLocalMax, updateDeadReckoning } from './util';

const SAFE_DIST = 15; // これを下回ったら壁沿い走行(wall-following)モードに切り替える
const WALL_TURN_STEP = 0.2; // 壁沿い走行中、1tickごとに固定方向へ回転する角度
const MAX_SEEK_TURN = 0.3; // 目標へ向かうとき、1tickあたりの旋回量の上限（暴走防止）
const BUILD_MARGIN = 0.75; // frontier.tsと同じ値・同じ理由（余裕を持ってmaxLineLength手前で建てる）
// memory[3]: 建設意思表示。frontier.tsはmemory[2]を使うが、このプログラムは
// memory[2]を壁沿い走行の回転方向(handedness)に使っているため、空いている
// memory[3]を使う（memory[0..1]はdead reckoningの共通の慣習）。
const INTENT_SLOT = 3;

/**
 * 前方1本のLIDAR(self.frontDist)だけで地形を突破する壁沿い走行
 * (wall-following、Bugアルゴリズム系列に着想を得た設計。詳細は
 * docs/engine-spec.md参照)に加えて、探索しながら補給所(Station)を
 * 建てて「実際に通れた経路の道しるべ」を残す。
 *
 * 単純なdead reckoning（直前の既知アンカーからの直線距離・方向の推定）
 * だけで帰路を決めると、往路が壁沿いに大きく迂回した場合、帰路の直線
 * 方向が高確率で別の壁を突っ切ってしまい、行きに迂回した分をまるごと
 * やり直すことになる（ブラウザでの目視確認で発覚）。frontier.tsが既に
 * 確立している「探索中、直前のアンカーからmaxLineLength手前まで離れたら
 * 補給所を建てる」パターンをそのまま流用することで、dead reckoningの
 * 基準点（＝「最後に触れたアンカー」）が経路に沿って前進し続け、帰路も
 * 一段ずつの短い区間の直線移動で済むようになる。建設の重複回避
 * (isLocalMaxによるリーダー選出)・帰路の方向計算に生のrelPosではなく
 * dead reckoningの積分値を使う理由（直視認しているアンカーの真上での
 * 振動を避けるため）も含め、frontier.tsのdocコメントに詳しい証明がある
 * ので、このプログラムでは繰り返さない。
 */
export const terrainProgram: Program = (self, neighbors) => {
  const wasIntending = self.memory[INTENT_SLOT] === 1;

  const anchors = neighbors.filter((n) => n.kind === 'base' || n.kind === 'station');
  const atAnchor = anchors.length > 0 && length(closest(anchors).relPos) < PHYSICS.interactRadius;
  if (atAnchor) {
    // ちょうど今アンカー(拠点or補給所)の近くにいるという直接知覚(ground truth)で、
    // dead reckoningの誤差を修正する（gather.ts/frontier.tsと同じ考え方）
    self.memory[0] = 0;
    self.memory[1] = 0;
  }

  const resources = neighbors.filter((n) => n.kind === 'resource' && (n.amount ?? 0) > 0);

  let steer = zero();
  let hasGoal = false;
  let harvest = false;

  if (self.cargo > 0) {
    // 視界内のアンカーの生のrelPosではなく、dead reckoningの積分値を使う。
    // 直前に自分で建てた補給所のほぼ真上にいる状況で生のrelPosを目標に
    // すると、1tickごとにオーバーシュートして前後に振動する不具合が
    // frontier.tsの前身(削除済みsupply-line.ts)で見つかっているため
    // （frontier.tsのdocコメント参照）。
    const homeVec = { x: -self.memory[0], y: -self.memory[1] };
    hasGoal = length(homeVec) > 0;
    steer = hasGoal ? normalize(homeVec) : zero();
  } else if (resources.length > 0) {
    const res = closest(resources);
    steer = normalize(res.relPos);
    hasGoal = true;
    harvest = length(res.relPos) < PHYSICS.interactRadius;
  }
  // 目標が何もない場合（資源も見えず、cargo===0）はhasGoal=falseのまま
  // （goalTurn=0で直進、下の壁沿いモードが自然に探索してくれる）。

  const goalTurn = hasGoal ? Math.atan2(steer.y, steer.x) : 0;
  const blocked = self.frontDist < SAFE_DIST;

  let turn: number;
  let speed: number;
  if (blocked) {
    const wasFollowing = self.memory[2] !== 0;
    const handedness = wasFollowing ? self.memory[2] : hasGoal ? (goalTurn >= 0 ? 1 : -1) : self.id % 2 === 0 ? 1 : -1;
    self.memory[2] = handedness;
    turn = handedness * WALL_TURN_STEP;
    // 完全に停止せず、今ある余裕(frontDist)の範囲でにじり寄りながら回転する。
    speed = Math.max(0, Math.min(self.frontDist - 2, PHYSICS.maxSpeed));
  } else {
    self.memory[2] = 0; // 開けたら壁沿いモードを解除（次に詰まった時また向きを選び直す）
    turn = Math.max(-MAX_SEEK_TURN, Math.min(MAX_SEEK_TURN, goalTurn));
    speed = PHYSICS.maxSpeed;
  }

  const drop = self.cargo > 0 && atAnchor;

  // estDist/wantsToBuildの判定は、この後のdead reckoning更新より前に
  // 「今tickの移動を反映する前のmemory」を使う必要がある（frontier.tsと
  // 同じ理由。呼び出し順を変えないこと）。
  const nearVisibleAnchor = anchors.some((a) => length(a.relPos) < PHYSICS.maxLineLength);
  const estDist = length({ x: self.memory[0], y: self.memory[1] });
  const wantsToBuild = self.cargo === 0 && !nearVisibleAnchor && estDist > PHYSICS.maxLineLength * BUILD_MARGIN;
  self.memory[INTENT_SLOT] = wantsToBuild ? 1 : 0;

  const intendingPeers = neighbors.filter((n) => n.kind === 'boid' && n.memory?.[INTENT_SLOT] === 1);
  const build = wantsToBuild && wasIntending && isLocalMax(self.id, intendingPeers);

  updateDeadReckoning(self.memory, turn, speed);

  return { turn, speed, harvest, drop, build };
};
