import type { Rectangle } from './geometry.js';
export type LayoutDirection = 'row' | 'column';
export interface LayoutStyle { direction?: LayoutDirection; width?: number; height?: number; flex?: number; gap?: number; padding?: number }
export interface LayoutNode { id: string; style: LayoutStyle; children: LayoutNode[]; frame: Rectangle }
export function createLayoutNode(id: string, style: LayoutStyle = {}, children: LayoutNode[] = []): LayoutNode { return { id, style: { ...style }, children: [...children], frame: { x: 0, y: 0, width: 0, height: 0 } }; }
