import { layoutTree } from './engine.js';
import { createLayoutNode, type LayoutNode, type LayoutStyle } from './node.js';
import type { Rectangle } from './geometry.js';
export type YogaLayoutNode = LayoutNode;
export const createYogaLayoutNode = (id: string, style: LayoutStyle = {}, children: LayoutNode[] = []): LayoutNode => createLayoutNode(id, style, children);
export const calculateYogaLayout = (node: LayoutNode, width: number, height: number, x = 0, y = 0): LayoutNode => layoutTree(node, { x, y, width, height } satisfies Rectangle);
