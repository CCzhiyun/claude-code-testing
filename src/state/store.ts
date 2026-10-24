import { resolve } from 'node:path';
import { createInitialAppState } from './AppState.js';
import { AppStateStore } from './AppStateStore.js';
let singleton: AppStateStore | undefined;
export function getAppStateStore(cwd = process.cwd()): AppStateStore { return singleton ??= new AppStateStore(createInitialAppState(resolve(cwd))); }
export function resetAppStateStore(cwd = process.cwd()): AppStateStore { singleton = new AppStateStore(createInitialAppState(resolve(cwd))); return singleton; }
