import type { AppState } from './AppState.js';
import type { AppStateStore } from './AppStateStore.js';
export function onChangeAppState<K extends keyof AppState>(store: AppStateStore, key: K, listener: (value: AppState[K], previous: AppState[K]) => void): () => void {
  return store.subscribe((state, previous) => { if (!Object.is(state[key], previous[key])) listener(state[key], previous[key]); });
}
