import { lineWidth } from './line-width-cache.js';

export interface MeasuredText { width: number; height: number }

export default function measureText(text: string, maxWidth: number): MeasuredText {
  if (text.length === 0) return { width: 0, height: 0 };
  const noWrap = maxWidth <= 0 || !Number.isFinite(maxWidth);
  let height = 0;
  let width = 0;
  let start = 0;
  while (start <= text.length) {
    const end = text.indexOf('\n', start);
    const line = end === -1 ? text.substring(start) : text.substring(start, end);
    const lineColumns = lineWidth(line);
    width = Math.max(width, lineColumns);
    height += noWrap ? 1 : lineColumns === 0 ? 1 : Math.ceil(lineColumns / maxWidth);
    if (end === -1) break;
    start = end + 1;
  }
  return { width, height };
}
