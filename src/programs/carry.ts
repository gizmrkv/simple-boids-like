import type { NeighborView, Program } from '../perception';
import { add, length, normalize, scale, sub, zero } from '../vec2';
import { CARRY_RADIUS, PHYSICS } from '../world';
import { closest, toAction } from './util';

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
 * 【小隊による探索(リーダー追従＋分離)】この交渉は「視界内に複数の資源が
 * 同時に見えている」ことが前提だが、資源を拠点から遠く・広く散らばらせると
 * viewRadius(60)では一度に1個しか見えなくなり、離れた場所で1体が資源を
 * 見つけても交渉相手が誰も近くにいなければ孤立してしまう。この対策として、
 * K体ずつ（KはrequiredCarriersと同数）の固定小隊（memory[4]に同じ値を持つ）
 * を組ませ、資源が見えていない探索中はReynoldsのboidsアルゴリズムの結合
 * (cohesion)＋分離(separation、別小隊のboidから離れる、frontier.tsと同じ式)
 * を使う。小隊で固まって動けば、誰かが資源を見つけた瞬間に他のK-1体も
 * ほぼ確実に近くにいるため、遠くの資源でも即座にK体で合流できる。分離に
 * より各小隊が互いに違う方向へ散らばりやすくもなる。
 *
 * 結合は当初、小隊内の全員が互いに引き合う双方向の力だったが、それぞれが
 * 同時に相手の"今"の位置へ補正をかけ合うため進路が安定せずくねくね曲がったり
 * 回り込んだりする非効率な動きになった（ユーザーがブラウザで発見、K=2で
 * 最初に見つかった）。ID比較（大きい方が優先、util.tsのisLocalMaxと同じ
 * 慣習）で小隊内のリーダーを1体だけ決め、リーダーは他の誰からも引かれず
 * 直進のみ、リーダー以外の全員がリーダーただ1体だけに向かって結合力を
 * 受ける片方向の関係にすることで解消した（K>=3でもフォロワー同士が互いに
 * 引き合わないようにするため、結合対象は常にリーダー1体に限定する）。
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

  // 小隊内のリーダー判定（ID比較、util.tsのisLocalMaxと同じ「大きい方が
  // 優先」という慣習）。小隊サイズがK>=2の場合も、視界内で見えている
  // 小隊メンバーの中でID最大の1体をリーダーとする。探索中の結合(cohesion)
  // だけでなく、運搬中の進行方向合わせ(alignment、下記参照)にも使う。
  const squadId = self.memory[4];
  const squadmates = boids.filter((b) => b.memory?.[4] === squadId);
  const leader =
    squadmates.length > 0 ? squadmates.reduce((a, b) => ((a.id ?? -Infinity) > (b.id ?? -Infinity) ? a : b)) : undefined;
  const isLeader = !leader || self.id > (leader.id ?? -Infinity);

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
      carry = targetId;
      if (isLeader || !leader) {
        // 運搬中: 「拠点そのもの」ではなく「資源から見た拠点の方向」を目指す。
        // boid自身が先に拠点へ着いてしまうと(資源はまだ手前)、boid→拠点の
        // ベクトルがほぼゼロになり停止してしまう不具合をheadless検証で発見した。
        steer = steerHome(hr);
      } else {
        // 追従役: 拠点方向は自分では計算せず、リーダーの"今"の実際の移動
        // 方向に合わせる(alignment)。当初は運搬中も各自dead reckoningで
        // 拠点方向を推定していたが、それぞれ別々の経路でここまで来ているため
        // 推定がズレやすく、互いに違う方向へ資源を引っ張ろうとした結果、
        // 資源から離れては近づいてを繰り返す不具合をユーザーがブラウザで
        // 発見した。追従役がリーダーの実速度に合わせれば、拠点が視界外でも
        // 全員が常に同じ方向を目指せる（K>=3でも、追従役全員が同じ1体の
        // リーダーに合わせるため方向がばらけない）。leader.relVelは
        // 「相手の実速度 - 自分の実速度」なので、自分の実速度(自分の
        // ローカル座標系では{self.speed, 0})を足し戻すとリーダーの実速度
        // そのものになる。
        const leaderVel = add(leader.relVel, { x: self.speed, y: 0 });
        steer = length(leaderVel) > 1e-6 ? normalize(leaderVel) : steerHome(hr);
      }
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
        return { hr, priority, dist: length(hr.relPos), required };
      });
      scored.sort((a, b) => a.priority - b.priority || a.dist - b.dist);
      const chosen = scored[0];
      const hr = chosen.hr;
      targetId = hr.id ?? NO_TARGET;

      if (chosen.dist <= PHYSICS.interactRadius) {
        // 未合流・狭い半径内: 自分を含めてrequiredCarriers体が同じ資源の
        // interactRadius内に揃っていれば合流を確定して運搬開始、足りなければ
        // その場で待機して残りが揃うのを待つ。他boidのrelPosとheavyのrelPosは
        // 同じtick・同じローカル座標系なので、差の長さがそのまま2者間の
        // 実際の距離になる。
        const nearbyCount = 1 + boids.filter((b) => length(sub(b.relPos, hr.relPos)) <= PHYSICS.interactRadius).length;
        if (nearbyCount >= chosen.required) {
          committed = true;
          carry = targetId;
          steer = steerHome(hr);
        } else {
          carry = targetId;
          steer = zero(); // 人数不足: その場で待機
        }
      } else {
        steer = normalize(hr.relPos);
      }
    } else {
      targetId = NO_TARGET;
      // 資源が見えていない探索中: 直進を基本バイアスとしつつ、小隊内の
      // リーダー追従(結合、片方向)・別小隊からの分離(separation、
      // frontier.tsと同じ「近いほど強く」の式)を加算してブレンドする。
      //
      // 当初は同じ小隊のboid同士が互いに相手へ結合しようとしていたが、
      // 双方が同時に相手の"今"の位置へ補正をかけ合うため、進路が安定せず
      // くねくね曲がったり2体で互いの周りを回り込んだりする非効率な動きに
      // なることをユーザーがブラウザで見つけた。ID比較(util.tsの
      // isLocalMaxと同じ「大きい方が優先」という慣習)でリーダーを1体だけ
      // 決め、リーダーは誰からも引かれず直進のみ、リーダー以外の全員が
      // リーダーただ1体だけへ向かって結合力を受けるという片方向の関係に
      // することで、進路がリーダー側で安定し、追従役はそれに沿って滑らかに
      // ついていくだけになる（小隊がK>=3でも、結合対象を常にリーダー1体に
      // 限定することでフォロワー同士の相互追跡を避けている）。
      //
      // なお、完全な直進(turn=0固定)は壁にほぼ垂直に近い角度で衝突すると
      // 境界反射(bounceOffWalls、x成分だけ反転)がほぼ同じ角度で反射され
      // 続けて壁際の狭い範囲に張り付いて抜け出せなくなる不具合が
      // headless検証で見つかっており(terrain.tsの局所ループ対策と同種)、
      // 直進バイアスには毎tick小さなランダム横揺れ(EXPLORE_JITTER)を
      // 加えて決定論的な反射ループを崩している。
      const forward =
        self.speed > PHYSICS.maxSpeed * 0.1 ? { x: 1, y: 0 } : { x: Math.cos(self.id), y: Math.sin(self.id) };
      let combined = add(forward, { x: 0, y: (Math.random() - 0.5) * EXPLORE_JITTER });
      if (!isLeader && leader && length(leader.relPos) > COHESION_MIN_DIST) {
        combined = add(combined, scale(normalize(leader.relPos), COHESION_WEIGHT));
      }
      for (const peer of boids) {
        if (peer.memory?.[4] === squadId) continue; // 同じ小隊: 結合はリーダーへのみ(上記)、分離は働かせない
        const d = length(peer.relPos);
        if (d < 1e-6) continue;
        combined = add(combined, scale(normalize(scale(peer.relPos, -1)), 1 / d));
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
  }

  return { ...action, carry };
};
