import type { PermissionMode } from '../types.js';
export interface AppState {
  cwd: string;
  sessionId?: string;
  activeAgentId?: string;
  permissionMode: PermissionMode;
  connected: boolean;
  unreadMessages: number;
}
export const createInitialAppState = (cwd: string): AppState => ({ cwd, permissionMode: 'normal', connected: false, unreadMessages: 0 });
