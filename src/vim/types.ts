export type Operator = 'delete' | 'change' | 'yank';
export type VimMode = 'INSERT' | 'NORMAL';
export type CommandState = { type: 'idle' } | { type: 'count'; digits: string } | { type: 'operator'; op: Operator; count: number };
export interface VimState { mode: VimMode; command: CommandState; register: string }
export interface VimEditResult { text: string; cursor: number; state: VimState; handled: boolean }
export const MAX_VIM_COUNT = 10_000;
export function createInitialVimState(): VimState { return { mode: 'INSERT', command: { type: 'idle' }, register: '' }; }
