import type { Program } from '../perception';
import { add, length, normalize, scale, zero } from '../vec2';
import { PHYSICS } from '../world';
import { closest, isLocalMax } from './util';

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
 * 視界内に誰もいなければ、直前の速度方向をそのまま維持する（一度散らばった
 * 後はまっすぐ進んで新しい領域を踏破するため）。ただしスポーン直後の1tick目は
 * `self.vel`がまだゼロなので、gather.tsの「何も見えなければ`self.id`から
 * 決まる固定方向」というイディオムを最初の一歩だけ借りる。以後は分離力と
 * 速度維持が主導権を持つため、この初期値は数tickで意味を失う。
 *
 * 分離力は「探索中(cargo===0)かつ視界内に資源が見えていないとき」だけに
 * 働かせる。資源やアンカーが視界に入った場合の優先順位は変えていない。
 *
 * 【dead reckoningの精度についての補足】
 * 経路が分離力で曲がっても`memory[0..1]`の精度は落ちない——これは
 * `self.vel`をそのまま毎tick積算しているだけの厳密な変位ベクトルであり、
 * 経路の直線・曲線に関わらず常に正確（「推定」ではなく計算上ちょうど
 * `boid.pos`の変化と一致する）。分離による寄り道の実際のコストは、同じ
 * 正味前進distanceを稼ぐのに実移動距離＝燃料をより多く使うという燃料効率の
 * 話であって、建設判断の精度には影響しない。
 *
 * 【復路：逆dead reckoning】
 * cargo>0のときはmemory[0..1]（最後にアンカーに触れてからの推定変位）の
 * 符号を反転した方向へ進む。特定アンカーのrelPosを狙わない設計は
 * supply-line.tsを踏襲している（詳細はsupply-line.tsのdocコメント参照）。
 *
 * 建設のリーダー選出（wasIntending + isLocalMax + nearVisibleAnchorガード）は
 * ladder.ts/supply-line.tsと全く同じ仕組み。正しさの根拠はladder.tsの
 * docコメント参照。
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

  const homeVec = { x: -self.memory[0], y: -self.memory[1] };
  const homeDir = length(homeVec) > 0 ? normalize(homeVec) : zero();
  const lowFuel = self.fuel < PHYSICS.maxFuel * FUEL_RETURN_RATIO;

  let steer = zero();
  let harvest = false;
  let drop = false;

  if (self.cargo > 0) {
    steer = homeDir;
    drop = anchors.length > 0 && length(closest(anchors).relPos) < PHYSICS.interactRadius;
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
      } else if (length(self.vel) > PHYSICS.maxSpeed * 0.1) {
        steer = normalize(self.vel);
      } else {
        steer = { x: Math.cos(self.id), y: Math.sin(self.id) };
      }
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
