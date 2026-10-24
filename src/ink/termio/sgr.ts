import type { Color, TextStyle } from './types.js';

function color(parameters: number[], index: number): { value?: Color; consumed: number } {
  const mode = parameters[index + 1];
  if (mode === 5) return { value: { mode: 'indexed', index: Math.max(0, Math.min(255, parameters[index + 2] ?? 0)) }, consumed: 2 };
  if (mode === 2) return { value: { mode: 'rgb', r: parameters[index + 2] ?? 0, g: parameters[index + 3] ?? 0, b: parameters[index + 4] ?? 0 }, consumed: 4 };
  return { consumed: 0 };
}

export function applySgr(style: TextStyle, parameters: readonly number[]): TextStyle {
  const next = { ...style }; const values = parameters.length ? [...parameters] : [0];
  for (let index = 0; index < values.length; index += 1) {
    const code = values[index] ?? 0;
    if (code === 0) Object.assign(next, { foreground: 'default', background: 'default', bold: false, dim: false, italic: false, underline: false, inverse: false, hidden: false, strikethrough: false });
    else if (code === 1) next.bold = true; else if (code === 2) next.dim = true; else if (code === 3) next.italic = true; else if (code === 4) next.underline = true;
    else if (code === 7) next.inverse = true; else if (code === 8) next.hidden = true; else if (code === 9) next.strikethrough = true;
    else if (code === 22) { next.bold = false; next.dim = false; } else if (code === 23) next.italic = false; else if (code === 24) next.underline = false;
    else if (code === 27) next.inverse = false; else if (code === 28) next.hidden = false; else if (code === 29) next.strikethrough = false;
    else if (code >= 30 && code <= 37) next.foreground = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'][code - 30] as Color;
    else if (code >= 40 && code <= 47) next.background = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'][code - 40] as Color;
    else if (code === 39) next.foreground = 'default'; else if (code === 49) next.background = 'default';
    else if (code === 38 || code === 48) { const parsed = color(values, index); if (parsed.value) { if (code === 38) next.foreground = parsed.value; else next.background = parsed.value; } index += parsed.consumed; }
  }
  return next;
}
