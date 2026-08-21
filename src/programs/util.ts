import type { NeighborView } from '../perception';
import { length } from '../vec2';
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
 * 「行きたい方向」を表すベクトル(steer、大きさは問わない)を、今のローカル
 * 座標系のままturn/speedアクションに変換する共通ヘルパー。steerは既に
 * heading基準（+x=自分の正面）で表現されているため、その角度がそのまま
 * turn量になる（自分のheadingを引き算する必要はない）。
 */
export function toAction(steer: { x: number; y: number }): { turn: number; speed: number } {
  return { turn: Math.atan2(steer.y, steer.x), speed: Math.min(length(steer), PHYSICS.maxSpeed) };
}
