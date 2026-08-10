import type { NeighborView } from '../perception';
import { length } from '../vec2';

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
