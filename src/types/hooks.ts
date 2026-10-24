import type { HookEvent } from '../types.js';

export const HOOK_EVENTS: HookEvent[] = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest', 'PermissionDenied', 'Stop', 'TaskCompleted', 'TeammateIdle'];
export const isHookEvent = (value: string): value is HookEvent => HOOK_EVENTS.includes(value as HookEvent);
export interface PromptRequest { prompt: string; message: string; options: Array<{ key: string; label: string; description?: string }> }
export interface PromptResponse { prompt_response: string; selected: string }
export interface SyncHookResponse { continue?: boolean; suppressOutput?: boolean; stopReason?: string; decision?: 'approve' | 'block'; reason?: string; systemMessage?: string; hookSpecificOutput?: Record<string, unknown> }

export function parseSyncHookResponse(value: unknown): SyncHookResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Hook response must be an object');
  const item = value as Record<string, unknown>;
  for (const key of ['continue', 'suppressOutput'] as const) if (item[key] !== undefined && typeof item[key] !== 'boolean') throw new Error(`Hook response ${key} must be boolean`);
  if (item.decision !== undefined && item.decision !== 'approve' && item.decision !== 'block') throw new Error('Hook response decision is invalid');
  for (const key of ['stopReason', 'reason', 'systemMessage'] as const) if (item[key] !== undefined && typeof item[key] !== 'string') throw new Error(`Hook response ${key} must be text`);
  return structuredClone(item) as SyncHookResponse;
}
