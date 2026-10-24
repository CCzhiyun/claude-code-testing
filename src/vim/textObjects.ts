export interface TextRange { start: number; end: number }
export function wordTextObject(text: string, offset: number, around = false): TextRange | undefined {
  const pattern = /\w+/g; let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index; let end = start + match[0].length;
    if (offset >= start && offset <= end) { if (around) { const spaces = text.slice(end).match(/^\s+/)?.[0].length ?? 0; end += spaces; } return { start, end }; }
  }
  return undefined;
}
export function delimitedTextObject(text: string, offset: number, open: string, close = open, around = false): TextRange | undefined {
  const start = text.lastIndexOf(open, offset); const end = text.indexOf(close, open === close ? offset + 1 : offset);
  if (start < 0 || end < 0 || end < start) return undefined;
  return around ? { start, end: end + close.length } : { start: start + open.length, end };
}
