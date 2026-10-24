import type { Rectangle } from './geometry.js';
import type { LayoutNode } from './node.js';

export function layoutTree(node: LayoutNode, frame: Rectangle): LayoutNode {
  node.frame = { ...frame }; const padding = Math.max(0, node.style.padding ?? 0); const gap = Math.max(0, node.style.gap ?? 0); const horizontal = node.style.direction === 'row';
  const mainSize = (horizontal ? frame.width : frame.height) - padding * 2 - gap * Math.max(0, node.children.length - 1);
  const fixed = node.children.reduce((sum, child) => sum + (horizontal ? child.style.width ?? 0 : child.style.height ?? 0), 0);
  const totalFlex = node.children.reduce((sum, child) => sum + (child.style.flex ?? 0), 0); let cursor = padding;
  for (const child of node.children) {
    const specified = horizontal ? child.style.width : child.style.height;
    const main = specified ?? (totalFlex ? Math.max(0, mainSize - fixed) * (child.style.flex ?? 0) / totalFlex : 0);
    const childFrame = horizontal
      ? { x: frame.x + cursor, y: frame.y + padding, width: main, height: child.style.height ?? Math.max(0, frame.height - padding * 2) }
      : { x: frame.x + padding, y: frame.y + cursor, width: child.style.width ?? Math.max(0, frame.width - padding * 2), height: main };
    layoutTree(child, childFrame); cursor += main + gap;
  }
  return node;
}
