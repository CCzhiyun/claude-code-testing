import { lineWidth } from './line-width-cache.js';

export function widestLine(value: string): number {
  let maxWidth = 0;
  let start = 0;
  while (start <= value.length) {
    const end = value.indexOf('\n', start);
    const line = end === -1 ? value.substring(start) : value.substring(start, end);
    maxWidth = Math.max(maxWidth, lineWidth(line));
    if (end === -1) break;
    start = end + 1;
  }
  return maxWidth;
}
