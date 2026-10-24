import type { AppState } from './AppState.js';
export const selectIsInteractive = (state: AppState): boolean => Boolean(state.sessionId);
export const selectCanSubmit = (state: AppState): boolean => state.connected && Boolean(state.sessionId);
export const selectHasUnreadMessages = (state: AppState): boolean => state.unreadMessages > 0;
export function createSelector<T>(selector: (state: AppState) => T): (state: AppState) => T { return selector; }
