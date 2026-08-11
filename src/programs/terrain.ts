import type { Program } from '../perception';
import { add, length, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest, isLocalMax, updateDeadReckoning } from './util';

const SAFE_DIST = 15; // これを下回ったら壁沿い走行(wall-following)モードに切り替える
const WALL_TURN_STEP = 0.2; // 壁沿い走行中、1tickごとに固定方向へ回転する角度
const MAX_SEEK_TURN = 0.3; // 目標へ向かうとき、1tickあたりの旋回量の上限（暴走防止）
const BUILD_MARGIN = 0.75; // frontier.tsと同じ値・同じ理由（余裕を持ってmaxLineLength手前で建てる）
const FUEL_RETURN_RATIO = 0.5; // frontier.ts/relay.tsと同じ値。残燃料がこの割合を切ったら帰還を優先する
const SEPARATION_MAX_TURN = 0.08; // 弱め。壁沿い走行(0.2/tick)より小さい摂動に留める
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
 *
 * 燃料まわり（低燃料時の緊急帰還、燃料切れ中のdead reckoning速度クランプ）も
 * frontier.tsで見つかった不具合の対策をそのまま流用している。壁沿い走行で
 * 迂回すると実移動距離（＝燃料消費）がdead reckoningの正味変位より大きく
 * 伸びうるため、素通りの直線距離を前提にしたmaxLineLengthの補給所建設
 * だけでは燃料切れ孤立を防ぎきれない可能性があり、同じ安全策を入れている。
 *
 * 【局所ループ対策としての弱い分離(Separation)】
 * 壁沿い走行は「前方が開けたら即座に目標追従モードへ戻る」だけで、Bug2の
 * ような「開始地点より目標に近づいたか」という進捗判定を持たない。その
 * ため、同じ障害物の周りで「壁沿い走行→少し開けて目標追従→また同じ障害物
 * にぶつかる」を繰り返す局所ループにはまり込むことがある（ブラウザでの
 * 目視確認で発覚）。地形やdead reckoningだけでは自力で抜け出せないため、
 * Reynoldsのboidsアルゴリズム本来の分離則を弱く加えた: 視界内の他boidから
 * 反発する方向へ、turnにSEPARATION_MAX_TURNを上限とする小さな補正を足す。
 * 他boidの位置は地形やdead reckoningとは独立に変動するため、同じ局所ループを
 * 毎回寸分違わず繰り返すことがなくなり、いずれ別の他boidが近くを通った
 * タイミングで軌道がずれてループを抜け出せる（ただし、他boidが誰も
 * 近づかない領域では効かない確率的な対策である点に注意）。壁沿い走行・
 * 目標追従の判断そのものは変えず、最終的なturnへの摂動としてだけ加える
 * ため、既存のhandedness選択やdead reckoningの精度には影響しない。
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
  // 視界内のアンカーの生のrelPosではなく、dead reckoningの積分値を使う。
  // 直前に自分で建てた補給所のほぼ真上にいる状況で生のrelPosを目標に
  // すると、1tickごとにオーバーシュートして前後に振動する不具合が
  // frontier.tsの前身(削除済みsupply-line.ts)で見つかっているため
  // （frontier.tsのdocコメント参照）。
  const homeVec = { x: -self.memory[0], y: -self.memory[1] };
  const homeDir = length(homeVec) > 0 ? normalize(homeVec) : zero();
  const lowFuel = self.fuel < PHYSICS.maxFuel * FUEL_RETURN_RATIO;

  let steer = zero();
  let hasGoal = false;
  let harvest = false;

  if (self.cargo > 0) {
    hasGoal = length(homeVec) > 0;
    steer = homeDir;
  } else if (resources.length > 0) {
    const res = closest(resources);
    steer = normalize(res.relPos);
    hasGoal = true;
    harvest = length(res.relPos) < PHYSICS.interactRadius;
  } else if (lowFuel) {
    // frontier.tsの緊急帰還と同じ考え方。壁沿い走行の迂回で実移動距離が
    // dead reckoningの正味変位より伸び、maxLineLength基準の補給所建設だけ
    // では間に合わず燃料切れ孤立に陥るケースへの備え。
    steer = anchors.length > 0 ? normalize(closest(anchors).relPos) : homeDir;
    hasGoal = length(steer) > 0;
  }
  // 目標が何もない場合（資源も見えず、cargo===0、燃料も十分）はhasGoal=false
  // のまま（goalTurn=0で直進、下の壁沿いモードが自然に探索してくれる）。

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

  // 局所ループ対策の弱い分離。視界内の他boidから、近いほど強く反発する
  // 方向へturnをわずかに補正する（frontier.tsの分離力と同じ計算式）。
  const peers = neighbors.filter((n) => n.kind === 'boid');
  let repel = zero();
  for (const peer of peers) {
    const d = length(peer.relPos);
    if (d < 1e-6) continue;
    repel = add(repel, scale(normalize(scale(peer.relPos, -1)), 1 / d));
  }
  if (length(repel) > 0) {
    const separationTurn = Math.atan2(repel.y, repel.x);
    turn += Math.max(-SEPARATION_MAX_TURN, Math.min(SEPARATION_MAX_TURN, separationTurn));
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

  // dead reckoning更新にはエンジンが実際に適用する速度を使う必要がある。
  // 燃料切れ中はsimulate.tsがspeedをPHYSICS.maxSpeed*emptyFuelSpeedRatioに
  // クランプするため、ここでも同じ上限を適用してから積算しないと「実際には
  // 少ししか動いていないのに動いた前提でhomeDirを計算し続け、2周期振動に
  // 陥る」不具合が起きる（frontier.tsで発見・修正済みのものと同種）。
  const speedCap = self.fuel > 0 ? PHYSICS.maxSpeed : PHYSICS.maxSpeed * PHYSICS.emptyFuelSpeedRatio;
  updateDeadReckoning(self.memory, turn, Math.min(speed, speedCap));

  return { turn, speed, harvest, drop, build };
};
