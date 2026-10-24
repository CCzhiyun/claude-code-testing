import type { HookEvent } from './types.js';
export const HOOK_EVENTS = ['SessionStart','SessionEnd','UserPromptSubmit','UserPromptExpansion','PreToolUse','PostToolUse','PostToolUseFailure','PostToolBatch','PermissionRequest','PermissionDenied','Notification','MessageDisplay','TaskCompleted','TeammateIdle','WorktreeCreate','WorktreeRemove','ConfigChange','Setup','Stop','StopFailure','InstructionsLoaded','CwdChanged','DirectoryAdded','FileChanged','PreCompact','PostCompact','PreModelSwitch','PostModelSwitch','Elicitation','ElicitationResult','TaskCreated','TaskUpdated','SubagentStart','SubagentStop','CheckpointCreated','CheckpointRestored'] as const satisfies readonly HookEvent[];
const allEventsCovered: Exclude<HookEvent, typeof HOOK_EVENTS[number]> extends never ? true : never = true;
void allEventsCovered;
const fields: Partial<Record<HookEvent, string[]>> = {
  PreToolUse: ['tool / tool_name', 'input / tool_input'], PostToolUse: ['tool', 'input', 'result'],
  TaskCompleted: ['task_id', 'agent_id', 'session_id', 'task_subject'], TeammateIdle: ['task_id', 'agent_id', 'session_id', 'task_subject'],
  WorktreeCreate: ['agentId', 'repo', 'worktree', 'branch', 'includedFiles'], WorktreeRemove: ['repo', 'worktree'],
  ConfigChange: ['path', 'keys'],
  FileChanged: ['path / file_path', 'change (created/modified/deleted) / event (add/change/unlink)', 'source=filesystem-watch for explicit external watcher', 'tool / checkpointId (when supplied)'],
  DirectoryAdded: ['path / directory', 'source=slash_command'],
  CwdChanged: ['old_cwd', 'new_cwd', 'Agent-local working directory only'],
  MessageDisplay: ['turn_id', 'message_id (stable within one message)', 'index (zero-based batch)', 'final (last batch only)', 'delta (message by default; configured line batch, display only)'],
  InstructionsLoaded: ['load_reason', 'source (repository-context / user-instructions / project-instructions / architecture-document / engineering-rule:user|project / skill / agent-profile / application-instructions / memory / scoped-rules)', 'path / rule_ids / instruction_id (when supplied)', 'included_text_digest / included_characters for individual included sources; never the instruction body'],
  Stop: ['stop_hook_active', 'last_assistant_message'], SubagentStop: ['stop_hook_active', 'last_assistant_message', 'parentId'],
  StopFailure: ['error (typed provider/credential/transport category)', 'error_details (redacted)', 'last_assistant_message (redacted model-boundary error)'],
};
export function hookCompatibilityMatrix() {
  return HOOK_EVENTS.map(event => ({ event, commonPayload: ['hook_event_name', 'cwd', 'session_id (when supplied)', 'agent_id (when supplied)'], callerFields: fields[event] ?? ['caller-specific; consult the actual lifecycle call site'],
    commandExitCodes: event === 'MessageDisplay' ? { '0':'displayContent changes surface only; continue/decision/context/input ignored', '2':'display helper falls back to canonical text; no action retry', other:'display helper falls back to canonical text; no action retry' } : event === 'StopFailure' ? { '0':'output ignored; notification only', '2':'failure audited; original model-boundary error retained; later observers still run', other:'failure audited; original model-boundary error retained; later observers still run' } : { '0': 'parse stdout; additionalContext/updatedInput/deny/continue=false enforced by dispatcher; informational callers never undo completed actions', '2': 'HookDecisionError retry=true; completion gates feed back before accepting completion; informational callers catch/report only', other: 'command error propagated; informational callers catch/report only' },
    provenance: 'plugin:<name> when contributed by a plugin; source does not grant permission',
    async: ['Stop','TaskCompleted','TeammateIdle','SubagentStop'].includes(event) ? 'rejected for completion gates' : 'command async dispatch only; no synchronous verdict',
    referenceParity: 'not-certified', note: 'This is the CCPT dispatcher contract, not a claim that every event is emitted at every reference lifecycle point. FileChanged/DirectoryAdded/lazy InstructionsLoaded production callers catch observer failures after the action: no rollback or automatic action retry. once uses cross-process durable receipts; incomplete/failed attempts require manual review and are not automatically replayed.' }));
}
