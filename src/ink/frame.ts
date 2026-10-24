import type { Size } from './layout/geometry.js';
export interface Cursor { x: number; y: number; visible: boolean }
export interface Frame { size: Size; lines: string[]; cursor?: Cursor; timestamp: number }
export interface FrameDiff { changedRows: number[]; resized: boolean }
export function emptyFrame(width = 0, height = 0): Frame { return { size: { width: Math.max(0, width), height: Math.max(0, height) }, lines: Array.from({ length: Math.max(0, height) }, () => ''), timestamp: Date.now() }; }
export function diffFrames(previous: Frame, next: Frame): FrameDiff { const resized = previous.size.width !== next.size.width || previous.size.height !== next.size.height; const length = Math.max(previous.lines.length, next.lines.length); return { resized, changedRows: Array.from({ length }, (_, index) => index).filter((index) => resized || previous.lines[index] !== next.lines[index]) }; }
