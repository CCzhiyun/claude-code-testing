export interface TerminalSize { width: number; height: number }
export interface Region { x: number; y: number; width: number; height: number }
export interface VerticalLayoutOptions { header?: number; footer?: number; gap?: number }

export function verticalLayout(size: TerminalSize, options: VerticalLayoutOptions = {}): { header: Region; content: Region; footer: Region } {
  const width = Math.max(1, Math.floor(size.width)); const height = Math.max(1, Math.floor(size.height));
  const gap = Math.max(0, Math.floor(options.gap ?? 0));
  const headerHeight = Math.min(height, Math.max(0, Math.floor(options.header ?? 0)));
  const footerHeight = Math.min(Math.max(0, height - headerHeight), Math.max(0, Math.floor(options.footer ?? 0)));
  const contentY = headerHeight + (headerHeight ? gap : 0);
  const footerY = Math.max(contentY, height - footerHeight);
  const contentHeight = Math.max(0, footerY - contentY - (footerHeight ? gap : 0));
  return { header: { x: 0, y: 0, width, height: headerHeight }, content: { x: 0, y: contentY, width, height: contentHeight }, footer: { x: 0, y: footerY, width, height: footerHeight } };
}

export function visibleWindow<T>(items: readonly T[], height: number, offset = 0): T[] {
  const count = Math.max(0, Math.floor(height)); const start = Math.max(0, Math.min(Math.floor(offset), Math.max(0, items.length - count)));
  return items.slice(start, start + count);
}
