const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function textSegments(text: string): Array<{ text: string; index: number }> {
  return [...graphemes.segment(text)].map(part => ({ text: part.segment, index: part.index }));
}

/** Cursor offsets stay UTF-16 for slicing, but every edit respects visible graphemes. */
export function movePromptCursor(text: string, cursor: number, direction: -1 | 1): number {
  const boundaries = [...textSegments(text).map(part => part.index), text.length];
  return direction < 0 ? boundaries.filter(index => index < cursor).at(-1) ?? 0
    : boundaries.find(index => index > cursor) ?? text.length;
}

export function deletePromptGrapheme(text: string, cursor: number, backward: boolean): { text: string; cursor: number } {
  const start = backward ? movePromptCursor(text, cursor, -1) : cursor;
  const end = backward ? cursor : movePromptCursor(text, cursor, 1);
  return { text: text.slice(0, start) + text.slice(end), cursor: start };
}

/** SGR styling is zero-width and must never be cut halfway through an escape. */
export function terminalSegments(text: string): string[] {
  return text.split(/(\u001b\[[0-9;:]*m)/g).flatMap(part => /^\u001b\[[0-9;:]*m$/.test(part) ? [part] : textSegments(part).map(item => item.text));
}
