import type { NeighborView } from '../perception';
import { length, rotate } from '../vec2';
import { PHYSICS } from '../world';

export function closest<T extends { relPos: { x: number; y: number } }>(items: T[]): T {
  return items.reduce((a, b) => (length(a.relPos) < length(b.relPos) ? a : b));
}

/**
 * 「意思表示中(intending)」であることが分かっている周囲のboid一覧の中で、
 * 自分(selfId)がID最大かどうかを判定する純粋な比較関数（リーダー選出の核）。
 * 「誰が意思表示中か」の絞り込み（kindやmemoryスロットの読み取り）は呼び出し
 * 側で済ませてから渡す——closest()と同じ役割分担。idはworld.ts側でグローバルに
 * 単調増加のユニークな値として払い出されるため、同点(tie)は起こり得ない。
 */
export function isLocalMax(selfId: number, intendingPeers: NeighborView[]): boolean {
  return intendingPeers.every((peer) => (peer.id ?? -Infinity) < selfId);
}

/**
 * dead reckoning（memory[0..1]に直前の既知アンカーからの推定変位を積算する
 * イディオム）を、boidごとに回転するローカル座標系のもとで正しく機能させる
 * ための共通ヘルパー。知覚(relPos等)は毎tick「その時点のheading基準」で
 * 表現されるため、蓄積してきた推定変位もこれから適用するturn分だけ
 * 逆回転させてから新しい移動量を足し込まないと、tickごとに異なる基準の
 * ベクトルを単純に足し合わせることになり推定が数学的に破綻する。
 *
 * 呼び出しは「今tickこれから返すturn/speedが決まった後」に行うこと
 * （まだ適用していない今回のturnぶんを逆回転の量として使うため）。
 */
export function updateDeadReckoning(memory: number[], turn: number, speed: number): void {
  const rotated = rotate({ x: memory[0], y: memory[1] }, -turn);
  memory[0] = rotated.x + speed;
  memory[1] = rotated.y;
}

/**
 * 「行きたい方向」を表すベクトル(steer、大きさは問わない)を、今のローカル
 * 座標系のままturn/speedアクションに変換する共通ヘルパー。steerは既に
 * heading基準（+x=自分の正面）で表現されているため、その角度がそのまま
 * turn量になる（自分のheadingを引き算する必要はない）。
 */
export function toAction(steer: { x: number; y: number }): { turn: number; speed: number } {
  return { turn: Math.atan2(steer.y, steer.x), speed: Math.min(length(steer), PHYSICS.maxSpeed) };
}
