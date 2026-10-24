import { isInclusiveMotion, lineEnd, lineStart, resolveMotion } from './motions.js';
import type { Operator, VimEditResult, VimState } from './types.js';

export function executeOperator(op: Operator, motion: string, count: number, text: string, cursor: number, state: VimState): VimEditResult {
  const target = resolveMotion(motion, text, cursor, count);
  const start = Math.min(cursor, target); const end = Math.max(cursor, target) + (isInclusiveMotion(motion) ? 1 : 0);
  const selected = text.slice(start, end);
  const nextState = { ...state, register: selected, command: { type: 'idle' } as const, ...(op === 'change' ? { mode: 'INSERT' as const } : {}) };
  if (op === 'yank') return { text, cursor, state: nextState, handled: true };
  return { text: text.slice(0, start) + text.slice(end), cursor: start, state: nextState, handled: true };
}
export function executeLineOperator(op: Operator, count: number, text: string, cursor: number, state: VimState): VimEditResult {
  const start = lineStart(text, cursor); let end = start;
  for (let index = 0; index < count; index += 1) end = Math.min(text.length, lineEnd(text, end) + 1);
  const selected = text.slice(start, end); const nextState = { ...state, register: selected, command: { type: 'idle' } as const, ...(op === 'change' ? { mode: 'INSERT' as const } : {}) };
  if (op === 'yank') return { text, cursor, state: nextState, handled: true };
  return { text: text.slice(0, start) + text.slice(end), cursor: Math.min(start, Math.max(0, text.length - selected.length)), state: nextState, handled: true };
}
