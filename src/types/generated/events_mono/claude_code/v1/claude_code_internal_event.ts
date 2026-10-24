import type { AuthContext } from '../../common/v1/auth.js';
export interface ClaudeCodeInternalEvent { eventName: string; sessionId: string; timestampMs: number; auth?: AuthContext; metadata: Record<string, string | number | boolean> }
