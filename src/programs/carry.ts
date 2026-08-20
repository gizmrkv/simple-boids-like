import type { NeighborView, Program } from '../perception';
import { add, length, normalize, scale, sub, zero } from '../vec2';
import { CARRY_RADIUS, PHYSICS } from '../world';
import { closest, toAction, updateDeadReckoning } from './util';

const NO_TARGET = -1; // memory[3]の「対象なし」を表す値。資源idは常に0以上のため衝突しない
const COHESION_MIN_DIST = CARRY_RADIUS; // これより近ければ小隊の結合力を働かせない（既に十分近いため）
const COHESION_WEIGHT = 0.5; // 結合力の重み（直進バイアスに対する相対的な強さ）
const EXPLORE_JITTER = 0.1; // 直進探索中に毎tick加える横揺れの大きさ（壁際の反射ループ対策）

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
 * 「既に足りている資源」を避ける、という優先順位で対象を選ぶ。
 *
 * 【小隊による探索(結合＋分離)】この交渉は「視界内に複数の資源が同時に
 * 見えている」ことが前提だが、資源を拠点から遠く・広く散らばらせると
 * viewRadius(60)では一度に1個しか見えなくなり、離れた場所で1体が資源を
 * 見つけても交渉相手が誰も近くにいなければ孤立してしまう。この対策として、
 * 2体ずつの固定ペア（小隊、memory[4]に同じ値を持つ）を組ませ、資源が
 * 見えていない探索中はReynoldsのboidsアルゴリズムの結合(cohesion、同じ
 * 小隊のboidへ寄る)＋分離(separation、別小隊のboidから離れる、frontier.ts
 * と同じ式)を使う。小隊で固まって動けば、誰かが資源を見つけた瞬間に
 * ペアの相方もほぼ確実に近くにいるため、遠くの資源でも即座に2体で合流
 * できる。分離により3小隊が互いに違う方向へ散らばりやすくもなる。
 * 小隊idはscenario側がspawn時にmemory[4]へ書き込む（プログラム側は読むだけ）。
 */
export const carryProgram: Program = (self, neighbors) => {
  const heavies = neighbors.filter((n) => n.kind === 'heavy');
  const bases = neighbors.filter((n) => n.kind === 'base');
  const boids = neighbors.filter((n) => n.kind === 'boid');

  let steer = zero();
  let carry: number | undefined;
  let committed = self.memory[2] > 0;
  let targetId = self.memory[3];

  const steerHome = (hr: NeighborView) =>
    bases.length > 0
      ? normalize(sub(closest(bases).relPos, hr.relPos))
      : normalize(scale({ x: self.memory[0], y: self.memory[1] }, -1));

  if (committed) {
    const hr = heavies.find((h) => h.id === targetId);
    // 相方(同じ資源へ向かっている他boid)が実際にCARRY_RADIUS内にまだ
    // いるかを毎tick確認する。相方が別の理由で離脱すると、資源自体は
    // (2体そろわないため)動かず静止したままなのに、自分だけは
    // 「運搬中のつもり」でsteerHome()に従って資源から遠ざかり続けて
    // しまい、CARRY_RADIUSを超過するまでの間(最大約20tick)無駄に離れて
    // いく不具合をheadless検証で発見した。この即時チェックで1tickで
    // 諦め直せるようにする。
    const required = hr?.requiredCarriers ?? 2;
    const nearbyHelpers =
      hr && boids.filter((b) => b.memory?.[3] === targetId && length(sub(b.relPos, hr.relPos)) <= CARRY_RADIUS).length;
    const stillStaffed = hr !== undefined && (nearbyHelpers ?? 0) + 1 >= required;

    if (hr && length(hr.relPos) <= CARRY_RADIUS && stillStaffed) {
      // 運搬中: 「拠点そのもの」ではなく「資源から見た拠点の方向」を目指す。
      // boid自身が先に拠点へ着いてしまうと(資源はまだ手前)、boid→拠点の
      // ベクトルがほぼゼロになり停止してしまう不具合をheadless検証で発見した。
      carry = targetId;
      steer = steerHome(hr);
    } else {
      // 運搬中だった資源を見失った(離れすぎた・搬入済みで消滅・相方が離脱):
      // 諦めて次tickに合流先を選び直す
      committed = false;
      targetId = NO_TARGET;
    }
  }

  if (!committed) {
    // 既にrequiredCarriers体以上が向かっている資源は最初から対象外にする。
    // 当初は「視界内で最も優先度が高いものを選ぶ」だけだったが、視界内に
    // それしか見えていない場合、既に足りている(運搬中で動いている)資源を
    // 追いかけ続けてしまい、動く対象を同じ速さで追うため追いつけず延々と
    // 浪費する不具合をheadless検証で発見した。この場合はその資源を無視して
    // 探索へ回るべき。
    const viable = heavies.filter((hr) => {
      const required = hr.requiredCarriers ?? 2;
      const helpers = boids.filter((b) => b.memory?.[3] === hr.id).length;
      return helpers < required;
    });

    if (viable.length > 0) {
      const scored = viable.map((hr) => {
        const required = hr.requiredCarriers ?? 2;
        const helpers = boids.filter((b) => b.memory?.[3] === hr.id).length;
        // 0: あと1人で成立する（最優先） 1: まだ誰も向かっていない（次点）
        const priority = helpers === required - 1 ? 0 : 1;
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
          carry = targetId;
          steer = steerHome(hr);
        } else {
          carry = targetId;
          steer = zero(); // 単独: その場で待機
        }
      } else {
        steer = normalize(hr.relPos);
      }
    } else {
      targetId = NO_TARGET;
      // 資源が見えていない探索中: 直進を基本バイアスとしつつ、同じ小隊への
      // 結合(cohesion、弱め)・別小隊からの分離(separation、frontier.tsと同じ
      // 「近いほど強く」の式)を加算してブレンドする。
      //
      // 当初は「結合力が働いたらそれだけで方向を決める(直進を完全に無視)」
      // 実装だったが、headless検証で2つの不具合が見つかった:
      // (1) 相方の"今"の相対位置へ毎tick全速で向かうため、間隔が詰まると
      //     行き過ぎて反転する追いかけっこの振動に陥り(小さい間隔では
      //     ほぼ停止、大きい間隔でも一定範囲を往復するだけで前進しない)、
      // (2) 何も押されていないときの完全な直進(turn=0固定)は、壁にほぼ
      //     垂直に近い角度で衝突すると境界反射(bounceOffWalls、x成分だけ
      //     反転)がほぼ同じ角度で反射され続け、壁際の狭い範囲に張り付いて
      //     抜け出せなくなる(terrain.tsの局所ループ対策と同種の問題)。
      // 対策として、結合力はCOHESION_MIN_DIST以内では働かせず(既に十分
      // 近いため)、働くときも直進バイアスに対して弱め(COHESION_WEIGHT)に
      // 加算するだけにして「相方の方向へ少し曲がりつつ概ね前進を続ける」
      // 動きにした。さらに直進バイアスに毎tick小さなランダム横揺れ
      // (EXPLORE_JITTER)を加え、決定論的な反射ループも崩す。
      const squadId = self.memory[4];
      const forward =
        self.speed > PHYSICS.maxSpeed * 0.1 ? { x: 1, y: 0 } : { x: Math.cos(self.id), y: Math.sin(self.id) };
      let combined = add(forward, { x: 0, y: (Math.random() - 0.5) * EXPLORE_JITTER });
      for (const peer of boids) {
        const d = length(peer.relPos);
        if (peer.memory?.[4] === squadId) {
          if (d > COHESION_MIN_DIST) combined = add(combined, scale(normalize(peer.relPos), COHESION_WEIGHT));
        } else {
          if (d < 1e-6) continue;
          combined = add(combined, scale(normalize(scale(peer.relPos, -1)), 1 / d));
        }
      }
      steer = length(combined) > 0 ? normalize(combined) : forward;
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
