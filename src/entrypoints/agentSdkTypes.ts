import type { AgentRecord, PermissionMode } from '../types.js';
import type { RuntimeEvent, RuntimeEventListener } from '../runtimeEvents.js';

export interface AgentSdkOptions {
  prompt: string;
  cwd?: string;
  agent?: string;
  permissionMode?: PermissionMode;
  isolation?: 'none' | 'worktree';
  background?: boolean;
  sessionId?: string;
  skills?: string[];
  systemPrompt?: string;
  structuredOutputSchema?: Record<string, unknown>;
  /** Receives the same ordered runtime events used by the terminal and IDE surfaces. */
  onEvent?: RuntimeEventListener;
}

export type AgentSdkEvent =
  | { type: 'started'; agent: AgentRecord }
  | { type: 'completed'; agent: AgentRecord }
  | { type: 'waiting_for_input'; agent: AgentRecord }
  | { type: 'failed'; agent: AgentRecord }
  | { type: 'runtime'; event: RuntimeEvent };
