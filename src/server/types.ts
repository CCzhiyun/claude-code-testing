export type SessionState = 'starting' | 'running' | 'detached' | 'stopping' | 'stopped';

export interface ServerConfig {
  baseUrl: string;
  token: string;
}

export interface SessionInfo {
  sessionId: string;
  wsUrl: string;
  workDir?: string;
  state: SessionState;
  createdAt: string;
}

export interface SessionIndex {
  version: 1;
  sessions: Record<string, SessionInfo>;
}

export interface DirectConnectCreateOptions {
  cwd: string;
  bypassPermissions?: boolean;
  resumeSessionId?: string;
}
