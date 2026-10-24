export interface PaletteViewport<T> {
  items: readonly T[];
  start: number;
  selected: number;
  above: number;
  below: number;
}

/** Keep the active palette item visible while using as much vertical space as possible. */
export function paletteViewport<T>(items: readonly T[], selected: number, height: number): PaletteViewport<T> {
  const count = Math.max(0, Math.min(items.length, Math.floor(height)));
  const safeSelected = items.length ? Math.max(0, Math.min(items.length - 1, Math.floor(selected))) : 0;
  const start = count ? Math.max(0, Math.min(safeSelected - count + 1, items.length - count)) : 0;
  const visible = items.slice(start, start + count);
  return {
    items: visible,
    start,
    selected: safeSelected - start,
    above: start,
    below: Math.max(0, items.length - start - visible.length),
  };
}
