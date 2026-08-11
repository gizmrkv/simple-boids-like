import type { Program } from '../perception';
import { length, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest, updateDeadReckoning } from './util';

const SAFE_DIST = 15; // これを下回ったら壁沿い走行(wall-following)モードに切り替える
const WALL_TURN_STEP = 0.2; // 壁沿い走行中、1tickごとに固定方向へ回転する角度
const MAX_SEEK_TURN = 0.3; // 目標へ向かうとき、1tickあたりの旋回量の上限（暴走防止）

/**
 * 前方1本のLIDAR(self.frontDist)だけで地形を突破するための壁沿い走行
 * (wall-following)アルゴリズム。ロボット工学のBugアルゴリズム系列
 * （Lumelsky & Stepanov 1987のBug2など、局所センサーだけで既知の目標へ
 * 到達する古典的な手法）に着想を得ている。
 *
 * 以前の実装（gatherベース＋回避操舵を毎tick加算合成）は、目標追従の旋回と
 * 回避の旋回が拮抗して打ち消し合う位置で完全に停止し、二度と動けなくなる
 * 局所解にheadless検証で頻繁にはまった（詳細はdocs/roadmap.md参照）。
 * 今回は「障害物がなければ目標へ直進、障害物にぶつかったら壁沿いモードに
 * “完全に”切り替える（加算しない）」という2モードの排他的な状態機械に
 * したのがポイント——両者を同時に足し合わせないので、力が拮抗して停止する
 * 状態が構造的に起こらない。
 *
 * 壁沿いモードに入った瞬間だけ回り込む方向(handedness、+1/-1)を目標方向
 * との位置関係から決め、障害物から離れるまで固定する。毎tick選び直すと、
 * 障害物の角で回転方向が行ったり来たりして進めなくなるため
 * （`self.memory[2]`に保持、0="今は壁沿いモードでない"）。
 */
export const terrainProgram: Program = (self, neighbors) => {
  const resources = neighbors.filter((n) => n.kind === 'resource' && (n.amount ?? 0) > 0);
  const bases = neighbors.filter((n) => n.kind === 'base');

  let steer = zero();
  let hasGoal = false;
  let nearestBaseDist = Infinity;
  let nearestResDist = Infinity;

  if (self.cargo > 0) {
    if (bases.length > 0) {
      const base = closest(bases);
      nearestBaseDist = length(base.relPos);
      steer = normalize(base.relPos);
    } else {
      steer = normalize(scale({ x: self.memory[0], y: self.memory[1] }, -1));
    }
    hasGoal = true;
  } else if (resources.length > 0) {
    const res = closest(resources);
    nearestResDist = length(res.relPos);
    steer = normalize(res.relPos);
    hasGoal = true;
  }
  // 目標が何も見えていない・dead reckoningの手がかりもない場合はgoalTurn=0
  // （今の向きのまま直進する）。地形にぶつかれば下の壁沿いモードが自然に
  // 探索してくれる。

  const goalTurn = hasGoal ? Math.atan2(steer.y, steer.x) : 0;
  const blocked = self.frontDist < SAFE_DIST;

  let turn: number;
  let speed: number;
  if (blocked) {
    const wasFollowing = self.memory[2] !== 0;
    const handedness = wasFollowing ? self.memory[2] : goalTurn >= 0 ? 1 : -1;
    self.memory[2] = handedness;
    turn = handedness * WALL_TURN_STEP;
    // 完全に停止せず、今ある余裕(frontDist)の範囲でにじり寄りながら回転する。
    // 素の停止(speed=0)だけだと、通路の入口にわずかに芯がずれているだけで
    // 開いている方向を見つけられず足踏みし続けるケースがあったため。
    speed = Math.max(0, Math.min(self.frontDist - 2, PHYSICS.maxSpeed));
  } else {
    self.memory[2] = 0; // 開けたら壁沿いモードを解除（次に詰まった時また向きを選び直す）
    turn = Math.max(-MAX_SEEK_TURN, Math.min(MAX_SEEK_TURN, goalTurn));
    speed = PHYSICS.maxSpeed;
  }

  const drop = self.cargo > 0 && nearestBaseDist < PHYSICS.interactRadius;
  if (drop) {
    self.memory[0] = 0;
    self.memory[1] = 0;
  } else {
    updateDeadReckoning(self.memory, turn, speed);
  }

  return {
    turn,
    speed,
    harvest: self.cargo === 0 && nearestResDist < PHYSICS.interactRadius,
    drop,
  };
};
