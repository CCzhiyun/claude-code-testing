export interface TerminalFocusState { focused: boolean; changedAt: number }
let state: TerminalFocusState = { focused: true, changedAt: Date.now() };
const listeners = new Set<() => void>();
export function getTerminalFocused(): boolean { return state.focused; }
export function getTerminalFocusState(): TerminalFocusState { return { ...state }; }
export function setTerminalFocused(focused: boolean): void { if (state.focused === focused) return; state = { focused, changedAt: Date.now() }; for (const listener of [...listeners]) listener(); }
export function subscribeTerminalFocus(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
