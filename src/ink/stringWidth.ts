const ansiPattern = /[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined;

function isControl(codePoint: number): boolean { return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f); }
function isInvisible(codePoint: number): boolean {
  return isControl(codePoint) || codePoint === 0x00ad || codePoint === 0x200b || codePoint === 0x200c || codePoint === 0x200d || codePoint === 0xfeff || (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}
function isFullwidth(codePoint: number): boolean {
  return codePoint >= 0x1100 && (codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) || (codePoint >= 0xac00 && codePoint <= 0xd7a3) || (codePoint >= 0xf900 && codePoint <= 0xfaff) || (codePoint >= 0xfe10 && codePoint <= 0xfe19) || (codePoint >= 0xfe30 && codePoint <= 0xfe6f) || (codePoint >= 0xff00 && codePoint <= 0xff60) || (codePoint >= 0xffe0 && codePoint <= 0xffe6) || (codePoint >= 0x20000 && codePoint <= 0x3fffd));
}
function isEmoji(codePoint: number): boolean { return (codePoint >= 0x1f1e6 && codePoint <= 0x1f1ff) || (codePoint >= 0x1f300 && codePoint <= 0x1faff) || (codePoint >= 0x2600 && codePoint <= 0x27bf); }

function fallbackStringWidth(value: string): number {
  const input = value.replace(ansiPattern, '');
  if (!input) return 0;
  let width = 0;
  const graphemes = segmenter ? [...segmenter.segment(input)].map((item) => item.segment) : [...input];
  for (const grapheme of graphemes) {
    const points = [...grapheme].map((character) => character.codePointAt(0)!);
    if (points.some(isEmoji)) { width += points.length === 1 && points[0]! >= 0x1f1e6 && points[0]! <= 0x1f1ff ? 1 : 2; continue; }
    const visible = [...grapheme].find((character) => {
      const point = character.codePointAt(0)!;
      return !isInvisible(point) && !/\p{Mark}/u.test(character);
    });
    if (visible) width += isFullwidth(visible.codePointAt(0)!) ? 2 : 1;
  }
  return width;
}

const bunWidth = typeof Bun !== 'undefined' && typeof Bun.stringWidth === 'function' ? Bun.stringWidth : undefined;
export const stringWidth: (value: string) => number = bunWidth ? (value) => bunWidth(value, { ambiguousIsNarrow: true }) : fallbackStringWidth;
