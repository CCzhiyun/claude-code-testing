import { resolve } from 'node:path';

export interface RuntimeState {
  originalCwd: string;
  projectRoot: string;
  cwd: string;
  startedAt: number;
  lastInteractionAt: number;
  queryCount: number;
  toolCount: number;
  totalQueryDurationMs: number;
  totalToolDurationMs: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  inMemoryErrors: Array<{ error: string; timestamp: string }>;
}

function initialState(cwd = process.cwd()): RuntimeState {
  const root = resolve(cwd);
  return { originalCwd: root, projectRoot: root, cwd: root, startedAt: Date.now(), lastInteractionAt: Date.now(), queryCount: 0, toolCount: 0, totalQueryDurationMs: 0, totalToolDurationMs: 0, totalLinesAdded: 0, totalLinesRemoved: 0, inMemoryErrors: [] };
}

let state = initialState();
export function getRuntimeState(): Readonly<RuntimeState> { return state; }
export function updateRuntimeState(patch: Partial<RuntimeState>): void { state = { ...state, ...patch, lastInteractionAt: Date.now() }; }
export function recordQuery(durationMs: number): void { updateRuntimeState({ queryCount: state.queryCount + 1, totalQueryDurationMs: state.totalQueryDurationMs + durationMs }); }
export function recordToolExecution(durationMs: number): void { updateRuntimeState({ toolCount: state.toolCount + 1, totalToolDurationMs: state.totalToolDurationMs + durationMs }); }
export function recordRuntimeError(error: unknown): void { state.inMemoryErrors.push({ error: error instanceof Error ? error.message : String(error), timestamp: new Date().toISOString() }); if (state.inMemoryErrors.length > 100) state.inMemoryErrors.splice(0, state.inMemoryErrors.length - 100); }
export function resetRuntimeState(cwd = process.cwd()): void { state = initialState(cwd); }
