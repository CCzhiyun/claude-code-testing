function clamp(value: number, text: string): number { return Math.max(0, Math.min(value, text.length)); }
export function lineStart(text: string, offset: number): number { return text.lastIndexOf('\n', Math.max(0, offset - 1)) + 1; }
export function lineEnd(text: string, offset: number): number { const end = text.indexOf('\n', offset); return end < 0 ? text.length : end; }
export function nextWord(text: string, offset: number): number { const match = text.slice(Math.min(text.length, offset + 1)).match(/(?:\s+|[^\w]+)(\w)/); return match?.index === undefined ? text.length : clamp(offset + 1 + match.index + match[0].length - 1, text); }
export function previousWord(text: string, offset: number): number { const prefix = text.slice(0, Math.max(0, offset)).replace(/\s+$/, ''); const matches = [...prefix.matchAll(/\w+/g)]; return matches.at(-1)?.index ?? 0; }
export function endWord(text: string, offset: number): number { const match = text.slice(offset).match(/\w+/); return match?.index === undefined ? offset : clamp(offset + match.index + match[0].length - 1, text); }
export function vertical(text: string, offset: number, direction: -1 | 1): number {
  const start = lineStart(text, offset); const column = offset - start;
  if (direction < 0) { if (start === 0) return offset; const previousEnd = start - 1; const previousStart = lineStart(text, previousEnd); return Math.min(previousStart + column, previousEnd); }
  const end = lineEnd(text, offset); if (end >= text.length) return offset; const nextStart = end + 1; return Math.min(nextStart + column, lineEnd(text, nextStart));
}
export function resolveMotion(key: string, text: string, offset: number, count = 1): number {
  let current = clamp(offset, text);
  for (let index = 0; index < count; index += 1) {
    const next = key === 'h' ? current - 1 : key === 'l' ? current + 1 : key === 'j' ? vertical(text, current, 1) : key === 'k' ? vertical(text, current, -1) : key === 'w' ? nextWord(text, current) : key === 'b' ? previousWord(text, current) : key === 'e' ? endWord(text, current) : key === '0' ? lineStart(text, current) : key === '^' ? lineStart(text, current) + (text.slice(lineStart(text, current), lineEnd(text, current)).match(/^\s*/)?.[0].length ?? 0) : key === '$' ? lineEnd(text, current) : current;
    current = clamp(next, text); if (next === current && next === offset) break;
  }
  return current;
}
export function isInclusiveMotion(key: string): boolean { return 'e$'.includes(key); }
