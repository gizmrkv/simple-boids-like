import type { Program } from '../perception';
import { add, length, normalize, rotate, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest, isLocalMax } from './util';

const SAFE_DIST = 15; // これを下回ったら壁沿い走行(wall-following)モードに切り替える
const WALL_TURN_STEP = 0.2; // 壁沿い走行中、1tickごとに固定方向へ回転する角度
const MAX_SEEK_TURN = 0.3; // 目標へ向かうとき、1tickあたりの旋回量の上限（暴走防止）
const BUILD_MARGIN = 0.75; // frontier.tsと同じ値・同じ理由（余裕を持ってmaxLineLength手前で建てる）
// 残燃料での走行可能距離(fuel/fuelBurnRate)が「最寄りアンカーまでの直線距離×
// この係数」を下回ったら緊急帰還する。1より大きくしているのは、壁沿い走行の
// 迂回で実移動距離が直線距離より伸びるぶんの安全マージン。
const FUEL_SAFETY_MARGIN = 1.3;
const SEPARATION_MAX_TURN = 0.08; // 弱め。壁沿い走行(0.2/tick)より小さい摂動に留める
// memory[3]: 建設意思表示。frontier.tsはmemory[2]を使うが、このプログラムは
// memory[2]を壁沿い走行の回転方向(handedness)に使っているため、空いている
// memory[3]を使う（memory[0..1]はdead reckoningの共通の慣習）。
const INTENT_SLOT = 3;

// 【局所ループ脱出用のランダム緊急旋回】
const FACING_TOLERANCE = 0.2; // rad。行き先とのなす角がこれ未満なら「正面を向いている」とみなす
const ESCAPE_STEPS = 20; // 緊急旋回の後、直進を継続するtick数
const ESCAPE_TURN_MIN = Math.PI / 2; // 90°。これ未満だと単なる壁沿い走行の延長になり局所ループを崩せない
const ESCAPE_TURN_MAX = Math.PI; // 180°
const ESCAPE_SLOT = 4; // memory[4]: エスケープ中の残りステップ数（0ならエスケープ中でない）
// memory[5..6]: エスケープ開始時に見えていた資源のrelPosを退避しておくスロット。
// エスケープで大きく向きを変えて視界(viewRadius)から資源が外れても、
// エスケープ終了後にその推定位置へ戻れるようにするため。
const REMEMBERED_TARGET_X = 5;
const REMEMBERED_TARGET_Y = 6;

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
 * 【局所ループ対策1: 弱い分離(Separation)】
 * 壁沿い走行は「前方が開けたら即座に目標追従モードへ戻る」だけで、Bug2の
 * ような「開始地点より目標に近づいたか」という進捗判定を持たない。その
 * ため、同じ障害物の周りで「壁沿い走行→少し開けて目標追従→また同じ障害物
 * にぶつかる」を繰り返す局所ループにはまり込むことがある（ブラウザでの
 * 目視確認で発覚）。対策として、視界内の他boidから反発する弱い分離則を
 * turnへの摂動として加えている。ただしこれは「たまたま近くに他boidがいれば」
 * という確率頼みの対策で、単独で局所ループにはまった場合は効かない。
 *
 * 【局所ループ対策2: ランダム緊急旋回】
 * 対策1だけでは根本解決にならない（ユーザーがブラウザで単独boidの
 * スタックを確認）ため、より直接的な対策を追加した。行き先があり・
 * その行き先にほぼ正面を向いており・行き先より手前に壁がある
 * （＝直進しても壁に阻まれるほぼ確実な状況）を検知したら、壁沿い走行を
 * 経由せずランダムに90°〜180°(符号もランダム)その場で向きを変え、
 * 一定tick(`ESCAPE_STEPS`)だけ直進を続けてから通常の目標追従に戻す。
 * 毎回独立な乱数で向きを変えるため、同じ壁際で同じ失敗を機械的に
 * 繰り返すことがなくなる（Bug2のような決定的な進捗保証はないが、他boidの
 * 存在に依存しない自己完結した対策になる）。
 *
 * 資源が行き先だった場合だけ追加の配慮が必要になる。拠点/補給所への帰還
 * (cargo>0・低燃料緊急帰還)はdead reckoning(memory[0..1])で追跡できる。この
 * 積算はsimulate.ts側（`applyDeadReckoning`）が物理適用後の実測値から行う
 * ため、エスケープで大きく迂回しても常に正確なままだが、資源は「今視界に
 * 入っている」前提の生の`relPos`しか持たないため、エスケープで視界
 * (viewRadius)の外に出ると見失ってしまう。そこで、エスケープ開始時点の
 * 資源の`relPos`を`memory[5..6]`へ退避し、dead reckoningと同じ回転補正を
 * 掛けつつ符号だけ逆（自分が前進した分だけ相手は近づく＝引き算）にした
 * 変換で毎tick追従させる。この退避スロットはsimulate.ts側では管理されない
 * プログラム独自の状態のため、こちらはこのプログラム自身が「要求した
 * turn/speed」で更新し続ける（壁反射時に多少ズレうるが、エスケープ中の
 * 一時的な目印にすぎないため実害は小さい）。エスケープ終了後は、視界内に
 * 資源が見えていればそちら（ground truth）を優先し、見えていなければこの
 * 退避しておいた推定位置へ向かう。
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
  // 資源を発見した、または搬入中になった時点で、退避しておいた資源の推定位置
  // (エスケープ用)は不要になる。次にエスケープする機会があれば改めて退避する。
  if (resources.length > 0 || self.cargo > 0) {
    self.memory[REMEMBERED_TARGET_X] = 0;
    self.memory[REMEMBERED_TARGET_Y] = 0;
  }
  const rememberedTarget = { x: self.memory[REMEMBERED_TARGET_X], y: self.memory[REMEMBERED_TARGET_Y] };

  const homeVec = { x: -self.memory[0], y: -self.memory[1] };
  // 燃料は距離1単位あたりfuelBurnRateだけ減る(simulate.ts参照)ため、速さに
  // 依存せず「残り走行可能距離」に換算できる。それを最寄りアンカーまでの
  // 直線距離(視界内に見えていればそのrelPos長、見えていなければdead
  // reckoningのhomeVec長)と比較する。
  const anchorDist = anchors.length > 0 ? length(closest(anchors).relPos) : length(homeVec);
  const remainingRange = self.fuel / PHYSICS.fuelBurnRate;
  const lowFuel = remainingRange < anchorDist * FUEL_SAFETY_MARGIN;

  // goalVecは正規化前の「行き先」ベクトル。方向(steer/goalTurn)だけでなく
  // 距離(goalDist)も後段のエスケープ判定に必要なため、ここでは正規化しない。
  // 優先順位: 帰還中 > 資源発見(視界内) > 退避しておいた資源の推定位置 > 低燃料緊急帰還。
  let goalVec = zero();
  let hasGoal = false;
  let harvest = false;
  let targetIsLiveResource = false;

  if (self.cargo > 0) {
    goalVec = homeVec;
    hasGoal = length(homeVec) > 0;
  } else if (resources.length > 0) {
    const res = closest(resources);
    goalVec = res.relPos;
    hasGoal = true;
    targetIsLiveResource = true;
    harvest = length(res.relPos) < PHYSICS.interactRadius;
  } else if (length(rememberedTarget) > 0) {
    goalVec = rememberedTarget;
    hasGoal = true;
  } else if (lowFuel) {
    // lowFuelの判定式(上のanchorDist/remainingRange)自体がfrontier.tsより
    // 精緻な帰還タイミング判断で、目指す先はそこで使ったのと同じアンカーになる。
    goalVec = anchors.length > 0 ? closest(anchors).relPos : homeVec;
    hasGoal = anchorDist > 0;
  }
  // 目標が何もない場合（資源も見えず、cargo===0、燃料も十分）はhasGoal=false
  // のまま（goalTurn=0で直進、下の壁沿いモードが自然に探索してくれる）。

  const goalDist = length(goalVec);
  const steer = hasGoal && goalDist > 0 ? normalize(goalVec) : zero();
  const goalTurn = hasGoal ? Math.atan2(steer.y, steer.x) : 0;
  const blocked = self.frontDist < SAFE_DIST;

  let turn: number;
  let speed: number;

  const escaping = self.memory[ESCAPE_SLOT] > 0;
  if (escaping) {
    // ランダム緊急旋回の後の直進区間。向きは変えず、ただ進む。
    turn = 0;
    speed = PHYSICS.maxSpeed;
    self.memory[ESCAPE_SLOT] -= 1;
  } else {
    const facingGoal = hasGoal && Math.abs(goalTurn) < FACING_TOLERANCE;
    const wallBeforeGoal = blocked && goalDist > 0 && self.frontDist < goalDist;

    if (facingGoal && wallBeforeGoal) {
      const magnitude = ESCAPE_TURN_MIN + Math.random() * (ESCAPE_TURN_MAX - ESCAPE_TURN_MIN);
      turn = Math.random() < 0.5 ? magnitude : -magnitude;
      speed = PHYSICS.maxSpeed;
      self.memory[ESCAPE_SLOT] = ESCAPE_STEPS;
      self.memory[2] = 0; // 壁沿い走行モードではないので、旧handednessは持ち越さない
      if (targetIsLiveResource) {
        self.memory[REMEMBERED_TARGET_X] = goalVec.x;
        self.memory[REMEMBERED_TARGET_Y] = goalVec.y;
      }
    } else if (blocked) {
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

    // 局所ループ対策1の弱い分離。視界内の他boidから、近いほど強く反発する
    // 方向へturnをわずかに補正する（frontier.tsの分離力と同じ計算式）。
    // エスケープ中(上のif分岐)には適用しない——大きく方向転換した直後に
    // さらに弱い摂動を足しても意味が薄く、直進区間の予測可能性を保つため。
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
  }

  const drop = self.cargo > 0 && atAnchor;

  const nearVisibleAnchor = anchors.some((a) => length(a.relPos) < PHYSICS.maxLineLength);
  const estDist = length({ x: self.memory[0], y: self.memory[1] });
  const wantsToBuild = self.cargo === 0 && !nearVisibleAnchor && estDist > PHYSICS.maxLineLength * BUILD_MARGIN;
  self.memory[INTENT_SLOT] = wantsToBuild ? 1 : 0;

  const intendingPeers = neighbors.filter((n) => n.kind === 'boid' && n.memory?.[INTENT_SLOT] === 1);
  const build = wantsToBuild && wasIntending && isLocalMax(self.id, intendingPeers);

  // memory[0..1]のdead reckoning自体はsimulate.ts側（`applyDeadReckoning`）が
  // 物理適用後の実測値から積算するためここでは触らないが、下のmemory[5..6]
  // （退避した資源の推定位置）はプログラム独自の状態でエンジンの管理対象外
  // のため、引き続きここで「エンジンが実際に適用するはずの速度」を使って
  // 手動で積算する。燃料切れ中はsimulate.tsがspeedをPHYSICS.maxSpeed*
  // emptyFuelSpeedRatioにクランプするため、ここでも同じ上限を適用しないと
  // 実際の移動量とズレる。
  const speedCap = self.fuel > 0 ? PHYSICS.maxSpeed : PHYSICS.maxSpeed * PHYSICS.emptyFuelSpeedRatio;
  const appliedSpeed = Math.min(speed, speedCap);

  // 退避しておいた資源の推定位置も、dead reckoningと同じ回転補正を掛けつつ
  // 符号だけ逆（自分が前進した分だけ相手は相対的に近づく）にして毎tick
  // 追従させる。memory[5..6]を直接読み直す（このtick中に上のロジックで
  // 新規に退避された場合も含めて、常に最新の値を移動量ぶん補正するため）。
  const rememberedNow = { x: self.memory[REMEMBERED_TARGET_X], y: self.memory[REMEMBERED_TARGET_Y] };
  if (length(rememberedNow) > 0) {
    const rotated = rotate(rememberedNow, -turn);
    self.memory[REMEMBERED_TARGET_X] = rotated.x - appliedSpeed;
    self.memory[REMEMBERED_TARGET_Y] = rotated.y;
  }

  return { turn, speed, harvest, drop, build };
};
