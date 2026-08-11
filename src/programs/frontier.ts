import type { Program } from '../perception';
import { add, length, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest, isLocalMax, toAction, updateDeadReckoning } from './util';

const BUILD_MARGIN = 0.75; // ladder.ts/supply-line.tsと同じ値・同じ理由
const INTENT_SLOT = 2; // memory[2]: 建設意思表示（ladder.ts/supply-line.tsと同じ）
const FUEL_RETURN_RATIO = 0.5; // relay.tsと同じ値。残燃料がこの割合を切ったら帰還を優先する

/**
 * ladder.ts + supply-line.tsの組み合わせから、EXPLORE_DIR/RETURN_DIRという
 * 「資源は拠点からこの方向にある」という決め打ちを取り除いたバージョン。
 * さらに、探索方向を外部から一切与えない（scenario側もmemoryに何も書き込まない）
 * ——各boidが視界内の情報だけを見て、自分でどちらへ進むか判断する。
 *
 * 【往路：分離（Separation）による自己組織化的な拡散】
 * 資源の位置を知る手段が一切ないため、「拠点から見てどちらに何もない
 * 領域が残っているか」を判断することも原理上できない。代わりに、Reynoldsの
 * boidsアルゴリズム（このプロジェクト名の由来）の3ルールのうち分離だけを
 * 使う: 視界内に他boidが見えていれば、それらの相対位置と逆方向へ
 * （近いboidほど強く）操舵する。群れが同じ場所にスポーンしても、
 * お互いを押しのけ合うことで局所ルールだけで自然に散らばっていく。
 *
 * 視界内に誰もいなければ、turn=0（直進）で今の向きを維持する（一度散らばった
 * 後はまっすぐ進んで新しい領域を踏破するため）。ただしスポーン直後の1tick目は
 * `self.speed`がまだゼロなので、gather.tsの「何も見えなければ`self.id`から
 * 決まる固定方向」というイディオムを最初の一歩だけ借りる。以後は分離力と
 * 直進維持が主導権を持つため、この初期値は数tickで意味を失う。
 *
 * 分離力は「探索中(cargo===0)かつ視界内に資源が見えていないとき」だけに
 * 働かせる。資源やアンカーが視界に入った場合の優先順位は変えていない。
 *
 * 【dead reckoningの精度についての補足】
 * 経路が分離力で曲がっても`memory[0..1]`の精度は落ちない。知覚全体が
 * boid自身のheading基準のローカル座標系で表現されるようになったため、
 * `updateDeadReckoning`（`programs/util.ts`）は毎tick「これから適用する
 * turn」ぶん蓄積値を逆回転させてから今tickの前進量を足し込む、回転補正付きの
 * 積算を行っている。これにより経路の直線・曲線に関わらず常に正確（「推定」
 * ではなく計算上ちょうど`boid.pos`の変化と一致する）。分離による寄り道の
 * 実際のコストは、同じ正味前進distanceを稼ぐのに実移動距離＝燃料をより多く
 * 使うという燃料効率の話であって、建設判断の精度には影響しない。
 *
 * 【復路：逆dead reckoning】
 * cargo>0のときはmemory[0..1]（最後にアンカーに触れてからの推定変位）の
 * 符号を反転した方向へ進む。視界内で見えている特定アンカーの`relPos`を
 * 直接狙う実装は避けている——直前に自分で建てた補給所のほぼ真上にいる
 * 状況では、視界内で唯一見えるアンカーがその補給所自身になり、1tickごとに
 * オーバーシュートして前後に符号が反転し続け、その場で永久に往復振動して
 * 前進しなくなる不具合が過去に見つかっている（削除済みのsupply-line.tsで
 * 発見）。dead reckoningの推定変位（＝時間方向に積分された滑らかな量）を
 * 目標にすればこの振動は起きない。搬入(drop)も同じ理由で「進む途中で
 * たまたまinteractRadius内に入ったアンカー（拠点でも補給所でも可）へ
 * 即座に落とす」という受動的な判定にしている。
 *
 * 【建設の集中回避（リーダー選出）】
 * 建設が無コストなため、分離力なしに密集した複数boidがほぼ同tickに閾値を
 * 超え、同じ場所に重複した補給所の山ができてしまう不具合が過去に見つかって
 * いる（削除済みのladder.ts/supply-line.tsで発見）。対策として、
 * memory[INTENT_SLOT]による意思表示＋util.tsのisLocalMaxによるID最大判定を
 * 使う: 視界内で意思表示中(memory[INTENT_SLOT]===1)の他boidの中に自分より
 * IDが大きい個体が1体もいなければ、自分が「ローカルでのID最大」として実際に
 * build:trueを出す。それ以外は意思表示だけして実際の建設は見送る。
 *
 * 【なぜ「今tick中の1回だけの判定」では不十分か（非自明な仕様なので詳述する）】
 * simulate.tsのstep()は`world.boids.map(...)`で全boid分のactionを先に集めるが、
 * 各boidの`boid.memory = self.memory`という書き戻しは、そのmapの中で当該boid
 * を処理した直後・他のboidの処理を待たずに行われる。かつbuildNeighborsは
 * `other.memory`を（コピーではなく）Boidオブジェクトから直接参照している。
 * `world.boids`の並びは常にID昇順（createWorldでの生成順）なので、結果として
 * 「自分よりIDが若い(=自分より先に処理された)boidが今tick書いたばかりの
 * memoryは、自分から見える」が「自分よりIDが大きい(=自分より後に処理される)
 * boidが今tick書くmemoryは、自分からはまだ見えず前tick終了時点の値のまま」
 * という非対称なリークが生じる。（heading/speedは全boid分をいったん
 * actions配列に退避してから一括適用するのでこの問題はなく、影響するのは
 * memoryだけ。）
 *
 * この非対称性のせいで、意思表示を「今tickその場」だけで比較すると壊れる:
 * 低ID L と高ID H が同tickに同時に意思表示を始めたとする。Lが先に処理される
 * ため、Lからは「Hはまだ意思表示していない(前tickの値=0)」ように見え、Lは
 * 自分がローカル最大だと誤判定して建設してしまう。直後、同tick内でHが処理
 * されると、上記リークのおかげでHには「Lが今tick書いたばかりの意思表示
 * (=1)」が見えるが、HはLがすでに建設を実行済みであることまでは知らない。
 * IDだけで比較すればH>Lなので、Hも「自分がローカル最大」と誤判定し、同じ
 * tickにHも建設してしまう——結果、LとHが同tickに重複して建設する。
 *
 * これを避けるため、「意思表示を出し始めたそのtickでは実際の建設を許可せず、
 * “前tick終了時点で既に意思表示していた”場合(wasIntending)のみ建設を許可
 * する」という1tick分の据え置きを入れている。2tick目以降であれば、安定して
 * 意思表示を続けているboidは前tickと同じ値を再送しているだけなので、上記
 * リークによって「新しい値」を見ようが「古い値」を見ようが結果は変わらず、
 * 非対称性は実害を持たなくなる。
 *
 * 実際、wasIntending + isLocalMaxの2条件を課すと、「互いに視界内(viewRadius)
 * にいるboid同士では、1tickにつき建設できるのは高々1体」がグローバルに成立
 * することを示せる。あるboid Xがこのtickに建設したとする。isLocalMax(X)=true
 * は「Xより後に処理される、Xより高IDの全peerについて、Xから見える値（＝その
 * peer自身にとっての“前tick終了時点の値”＝自身のwasIntendingそのもの）が1
 * でない」ことを意味するので、Xより高IDの全peerはこのtick必ずwasIntending=
 * falseとなり建設できない。逆に、Xを視界に持つXより低いIDのpeer Zにとって、
 * Xの値は（Zより先には処理されないので）“前tick終了時点”の値として見える。
 * wasIntending(X)=trueである以上その値は1なので、isLocalMax(Z)は必ずfalseに
 * なり、Zも建設できない。（視界外にいる、互いに見えない別クラスタが同tickに
 * 独立して建設するのは別の話で、意図通り許容している。）
 *
 * 【敗れた側が「もう一段先」で重複建設してしまう別の穴（ヘッドレスで発見）】
 * 上記だけでは同tickの重複は防げても、敗れた側（isLocalMaxがfalseだった
 * 個体）が近くにもう1つ補給所を建ててしまうケースが残っていた。dead
 * reckoningのリセット判定(atAnchor)はinteractRadius(8)という狭い範囲でしか
 * 発動しないため、敗れた側が勝者の建設地点からinteractRadiusよりわずかに
 * 遠い位置にいると、リセットされないままestDistが閾値を超え続け、勝者が
 * 建設完了して意思表示をやめた次のtickに「もう競争相手がいない」と誤認識し
 * 自分も建ててしまう。これを防ぐため、dead reckoningのリセット判定
 * (interactRadius、精度重視でそのまま維持)とは別に、視界内にmaxLineLength
 * 以内のアンカーが1つでも見えていたら無条件でwantsToBuildを取り下げる
 * （`nearVisibleAnchor`）ガードを追加している。
 *
 * 【低燃料時の緊急帰還（ヘッドレスで発見した不具合の修正）】
 * 分離力だけで探索させる最初のバージョンには、全boidが燃料切れで孤立し
 * 二度と動けなくなる不具合があった（headless 10回中3〜4回で再現）。原因は
 * 「拠点は視界に入っている（`nearVisibleAnchor=true`のため重複建設ガードが
 * 正しく働き、新規建設はしない）のに、密集した仲間同士の分離力に押されて
 * `interactRadius`(8px)というピンポイントには一向にたどり着けず、燃料だけ
 * 消費し続けて力尽きる」という板挟み状態。分離力には「特定の1点へ収束する」
 * 力が原理的に無いため、いつまで経ってもこの状態から自然に脱出できなかった。
 * 対策として、relay.tsの`lowFuel`と同じ閾値(`FUEL_RETURN_RATIO=0.5`)を導入し、
 * 残燃料が半分を切ったら（かつcargo===0で資源も見えていない場合）、分離力を
 * 完全に無視して「視界内にアンカーが見えていればその真の`relPos`へ直進、
 * 見えていなければ逆dead reckoningで最後に触れたアンカーへ直進」する緊急
 * 帰還モードに切り替える。アンカーへの直進は他boidの分離力による多方向からの
 * 干渉を受けなくなるため、確実に`interactRadius`内へ到達でき燃料が回復する。
 *
 * 【燃料切れ中の減速とdead reckoningのズレ（ヘッドレスで発見した不具合）】
 * simulate.tsは燃料切れ中、boidの実速度をPHYSICS.maxSpeed×emptyFuelSpeedRatio
 * （既定20%）にクランプする（以前は完全停止だったが、ユーザーの要求で
 * 「遅くなるが動ける」に変更された）。これに合わせずdead reckoningの更新に
 * `action.speed`（プログラムが要求した、クランプ前の速度）をそのまま使うと、
 * 「本当は0.2しか進んでいないのに1.0進んだ前提でhomeDir（家の方向）を
 * 計算し続ける」ズレが毎tick蓄積する。このズレの積分は数学的に不安定な
 * 2周期振動（`turn`が毎tick約180°反転し、正味の移動量がゼロになる）に
 * 収束することが判明した——燃料切れ中に何十tickも同じ場所で足踏みし続ける
 * 形で表面化する。dead reckoning更新の直前でエンジンと同じ速度上限を適用
 * することで解消している。
 */
export const frontierProgram: Program = (self, neighbors) => {
  const wasIntending = self.memory[INTENT_SLOT] === 1;

  const anchors = neighbors.filter((n) => n.kind === 'base' || n.kind === 'station');
  const atAnchor = anchors.length > 0 && length(closest(anchors).relPos) < PHYSICS.interactRadius;
  if (atAnchor) {
    // ちょうど今アンカーの近くにいるという直接知覚(ground truth)で、
    // dead reckoningの誤差を修正する（gather.ts/formation.tsと同じ考え方）
    self.memory[0] = 0;
    self.memory[1] = 0;
  }

  const homeVec = { x: -self.memory[0], y: -self.memory[1] };
  const homeDir = length(homeVec) > 0 ? normalize(homeVec) : zero();
  const lowFuel = self.fuel < PHYSICS.maxFuel * FUEL_RETURN_RATIO;

  let steer = zero();
  let harvest = false;
  let drop = false;

  if (self.cargo > 0) {
    steer = homeDir;
    drop = atAnchor;
  } else {
    const resources = neighbors.filter((n) => n.kind === 'resource' && (n.amount ?? 0) > 0);
    if (resources.length > 0) {
      const res = closest(resources);
      steer = normalize(res.relPos);
      harvest = length(res.relPos) < PHYSICS.interactRadius;
    } else if (lowFuel) {
      steer = anchors.length > 0 ? normalize(closest(anchors).relPos) : homeDir;
    } else {
      const peers = neighbors.filter((n) => n.kind === 'boid');
      let repel = zero();
      for (const peer of peers) {
        const d = length(peer.relPos);
        if (d < 1e-6) continue;
        repel = add(repel, scale(normalize(scale(peer.relPos, -1)), 1 / d));
      }
      if (length(repel) > 0) {
        steer = normalize(repel);
      } else if (self.speed > PHYSICS.maxSpeed * 0.1) {
        // 何にも押されていなければ直進（turn=0）で維持する
        steer = { x: 1, y: 0 };
      } else {
        steer = { x: Math.cos(self.id), y: Math.sin(self.id) };
      }
    }
  }

  // estDist/wantsToBuildの判定は、この後のdead reckoning更新より前に
  // 「今tickの移動を反映する前のmemory」を使う必要がある（呼び出し順を
  // 変えないこと。updateDeadReckoningを先に呼ぶと今tick分の移動が
  // 混ざってしまい判定が変わる）。
  const nearVisibleAnchor = anchors.some((a) => length(a.relPos) < PHYSICS.maxLineLength);
  const estDist = length({ x: self.memory[0], y: self.memory[1] });
  const wantsToBuild = self.cargo === 0 && !nearVisibleAnchor && estDist > PHYSICS.maxLineLength * BUILD_MARGIN;
  self.memory[INTENT_SLOT] = wantsToBuild ? 1 : 0;

  const intendingPeers = neighbors.filter((n) => n.kind === 'boid' && n.memory?.[INTENT_SLOT] === 1);
  const build = wantsToBuild && wasIntending && isLocalMax(self.id, intendingPeers);

  const action = toAction(steer);
  // dead reckoningの更新にはエンジンが実際に適用する速度を使わないと、
  // memoryの推定がボイド自身の実際の移動とズレていく。燃料切れ中は
  // エンジン側(simulate.ts)がspeedをPHYSICS.maxSpeed*emptyFuelSpeedRatioに
  // クランプするため、ここでも同じ上限を適用してから積算する（そうしないと
  // 「実際には少ししか動いていないのに、動いた前提でhomeDirを計算し続け、
  // 数tickで180°反転を繰り返す振動に陥る」不具合が燃料切れ時に起きる—
  // ヘッドレス検証で発見）。
  const speedCap = self.fuel > 0 ? PHYSICS.maxSpeed : PHYSICS.maxSpeed * PHYSICS.emptyFuelSpeedRatio;
  updateDeadReckoning(self.memory, action.turn, Math.min(action.speed, speedCap));

  return { ...action, harvest, drop, build };
};
