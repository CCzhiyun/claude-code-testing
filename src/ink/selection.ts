import { clamp } from './layout/geometry.js';
export interface SelectionPoint { row: number; column: number }
export interface SelectionState { anchor?: SelectionPoint; focus?: SelectionPoint }
export function createSelectionState(): SelectionState { return {}; }
export function startSelection(state: SelectionState, point: SelectionPoint): void { state.anchor = { ...point }; state.focus = { ...point }; }
export function extendSelection(state: SelectionState, point: SelectionPoint): void { if (!state.anchor) state.anchor = { ...point }; state.focus = { ...point }; }
export function clearSelection(state: SelectionState): void { delete state.anchor; delete state.focus; }
export function hasSelection(state: SelectionState): boolean { return Boolean(state.anchor && state.focus && (state.anchor.row !== state.focus.row || state.anchor.column !== state.focus.column)); }
export function getSelectedText(lines: readonly string[], state: SelectionState): string { if (!state.anchor || !state.focus) return ''; const [start, end] = compare(state.anchor, state.focus) <= 0 ? [state.anchor, state.focus] : [state.focus, state.anchor]; return lines.slice(start.row, end.row + 1).map((line, index, selected) => { const from = index === 0 ? clamp(start.column, 0, line.length) : 0; const to = index === selected.length - 1 ? clamp(end.column, 0, line.length) : line.length; return line.slice(from, to); }).join('\n'); }
function compare(left: SelectionPoint, right: SelectionPoint): number { return left.row - right.row || left.column - right.column; }
