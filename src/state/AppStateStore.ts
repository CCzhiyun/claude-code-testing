import type { AppState } from './AppState.js';
export type AppStateListener = (state: Readonly<AppState>, previous: Readonly<AppState>) => void;
export class AppStateStore {
  private listeners = new Set<AppStateListener>();
  constructor(private state: AppState) {}
  get(): Readonly<AppState> { return this.state; }
  set(update: Partial<AppState> | ((state: Readonly<AppState>) => Partial<AppState>)): Readonly<AppState> {
    const previous = this.state;
    const patch = typeof update === 'function' ? update(previous) : update;
    this.state = { ...previous, ...patch };
    for (const listener of this.listeners) listener(this.state, previous);
    return this.state;
  }
  subscribe(listener: AppStateListener): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
}
