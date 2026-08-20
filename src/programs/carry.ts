import type { NeighborView, Program } from '../perception';
import { length, normalize, scale, sub, zero } from '../vec2';
import { CARRY_RADIUS, PHYSICS } from '../world';
import { closest, toAction, updateDeadReckoning } from './util';

const NO_TARGET = -1; // memory[3]の「対象なし」を表す値。資源idは常に0以上のため衝突しない

/**
 * 重量資源(heavy)を見つけて拠点まで運ぶ。requiredCarriers体以上が同時に
 * 資源のそばでcarryを出さないと資源自体は動かない（協調が必須のメカニクス）。
 * cargoは一切使わない（誰が運んでいるかはboidの内部記憶ではなく、そのtickに
 * carryを出しているboidの数という外部集計で決まる設計のため）。
 *
 * 合流(interactRadius、狭い)と維持(CARRY_RADIUS、広い)で別々の半径を使う
 * ヒステリシス設計。単一の半径だと、資源のそばで拠点方向へ動き出した瞬間
 * （＝資源から遠ざかる動き）にその半径をまたぎ越して「離れすぎ」と判定され、
 * 次tickには資源へ戻る…を無限に繰り返す境界振動が起きることをheadless検証
 * で発見した（合流トリガーの半径ちょうどのところで待機を始めるため、動き出す
 * 側に余白が全くない）。合流は狭い半径で厳密に、いったん合流した後の「まだ
 * 運搬中か」の判定は広い半径で緩く判定することで、拠点方向への移動が
 * 半径を割ってしまう余地をなくす。「今運搬中か」はmemory[2]に0/1で保持する
 * （memory[0..1]はdead reckoning用、慣習は`docs/engine-spec.md`参照）。
 *
 * 【資源が余る状況への対応・交渉】視界内に複数の重量資源がある場合、全boidが
 * 単純に最寄りを選ぶと「誰も来ない資源」と「過剰に集まる資源」に偏り、
 * 資源の数がboidのペア数を上回ると詰む。これを避けるため、「今どの資源に
 * 向かっているか(id)」をmemory[3]で常時ブロードキャストし、他boidはそれを
 * 見て「あと1人で成立する資源」を最優先、「まだ誰もいない資源」を次点、
 * 「既に足りている資源」を避ける、という優先順位で対象を選ぶ。視界内で
 * 完結する狭い情報からの意思決定だが、資源はいずれも拠点からviewRadius内に
 * 配置されるシナリオ設計のため、拠点付近にいれば全資源の状況を俯瞰できる。
 */
export const carryProgram: Program = (self, neighbors) => {
  const heavies = neighbors.filter((n) => n.kind === 'heavy');
  const bases = neighbors.filter((n) => n.kind === 'base');
  const boids = neighbors.filter((n) => n.kind === 'boid');

  let steer = zero();
  let carry = false;
  let committed = self.memory[2] > 0;
  let targetId = self.memory[3];

  const steerHome = (hr: NeighborView) =>
    bases.length > 0
      ? normalize(sub(closest(bases).relPos, hr.relPos))
      : normalize(scale({ x: self.memory[0], y: self.memory[1] }, -1));

  if (committed) {
    const hr = heavies.find((h) => h.id === targetId);
    if (hr && length(hr.relPos) <= CARRY_RADIUS) {
      // 運搬中: 「拠点そのもの」ではなく「資源から見た拠点の方向」を目指す。
      // boid自身が先に拠点へ着いてしまうと(資源はまだ手前)、boid→拠点の
      // ベクトルがほぼゼロになり停止してしまう不具合をheadless検証で発見した。
      carry = true;
      steer = steerHome(hr);
    } else {
      // 運搬中だった資源を見失った(離れすぎた、または搬入済みで消滅した):
      // 諦めて次tickに合流先を選び直す
      committed = false;
      targetId = NO_TARGET;
    }
  }

  if (!committed) {
    if (heavies.length > 0) {
      const scored = heavies.map((hr) => {
        const required = hr.requiredCarriers ?? 2;
        const helpers = boids.filter((b) => b.memory?.[3] === hr.id).length;
        // 0: あと1人で成立する（最優先） 1: まだ誰もいない（次点） 2: 既に足りている（避ける）
        const priority = helpers === required - 1 ? 0 : helpers === 0 ? 1 : 2;
        return { hr, priority, dist: length(hr.relPos) };
      });
      scored.sort((a, b) => a.priority - b.priority || a.dist - b.dist);
      const chosen = scored[0];
      const hr = chosen.hr;
      targetId = hr.id ?? NO_TARGET;

      if (chosen.dist <= PHYSICS.interactRadius) {
        // 未合流・狭い半径内: もう1体が同じ資源のinteractRadius内にいれば合流を
        // 確定して運搬開始、いなければその場で待機して2体目を待つ。他boidの
        // relPosとheavyのrelPosは同じtick・同じローカル座標系なので、差の長さが
        // そのまま2者間の実際の距離になる。
        const accompanied = boids.some((b) => length(sub(b.relPos, hr.relPos)) <= PHYSICS.interactRadius);
        if (accompanied) {
          committed = true;
          carry = true;
          steer = steerHome(hr);
        } else {
          carry = true;
          steer = zero(); // 単独: その場で待機
        }
      } else {
        steer = normalize(hr.relPos);
      }
    } else {
      targetId = NO_TARGET;
      // 何も見えていなければ直進（turn=0）で探索する。ただしスポーン直後
      // (speedがまだ小さい)だけは自分のIDに応じた固定方向を初期値にする
      steer = self.speed > PHYSICS.maxSpeed * 0.1 ? { x: 1, y: 0 } : { x: Math.cos(self.id), y: Math.sin(self.id) };
    }
  }

  self.memory[2] = committed ? 1 : 0;
  self.memory[3] = targetId;

  const action = toAction(steer);

  // 拠点がinteractRadius内に見えているときだけdead reckoningをゼロへ矯正する
  // （gatherProgramのdrop時の矯正と同じ発想。carry状態とは無関係に判定できる）。
  const nearBase = bases.length > 0 && length(closest(bases).relPos) <= PHYSICS.interactRadius;
  if (nearBase) {
    self.memory[0] = 0;
    self.memory[1] = 0;
  } else {
    updateDeadReckoning(self.memory, action.turn, action.speed);
  }

  return { ...action, carry };
};
