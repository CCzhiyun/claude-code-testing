export * from './enums.js';
export interface LayoutNode { width?: number; height?: number; flexGrow?: number; children?: LayoutNode[] }
export interface ComputedLayout { x: number; y: number; width: number; height: number; children: ComputedLayout[] }
export function computeColumnLayout(node: LayoutNode, availableWidth: number, availableHeight: number): ComputedLayout {
  const children = node.children ?? []; const fixed = children.reduce((sum, child) => sum + (child.height ?? 0), 0); const grow = children.reduce((sum, child) => sum + (child.flexGrow ?? 0), 0); let y = 0;
  const layouts = children.map((child) => { const height = child.height ?? (grow ? (availableHeight - fixed) * (child.flexGrow ?? 0) / grow : 0); const layout = computeColumnLayout(child, child.width ?? availableWidth, height); layout.y = y; y += height; return layout; });
  return { x: 0, y: 0, width: node.width ?? availableWidth, height: node.height ?? availableHeight, children: layouts };
}
