import { length } from '../vec2';

export function closest<T extends { relPos: { x: number; y: number } }>(items: T[]): T {
  return items.reduce((a, b) => (length(a.relPos) < length(b.relPos) ? a : b));
}
