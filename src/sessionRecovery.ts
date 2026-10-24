import { resolve } from 'node:path';
import type { AgentRecord, ModelMessage, SessionRecord } from './types.js';

const key = (path: string): string => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
export function sameSessionWorkspace(left: string, right: string): boolean { return key(left) === key(right); }
/** A displayed PowerShell handoff, never executed by the picker. */
export function sessionResumeCommand(session: Pick<SessionRecord, 'id' | 'cwd'>): string {
  if (!/^session_[a-f0-9]{16}$/.test(session.id) || /[\x00-\x1f\x7f-\x9f]/.test(session.cwd)) throw new Error('Invalid session handoff target');
  return `ccpt --cwd '${session.cwd.replaceAll("'", "''")}' --resume '${session.id}'`;
}
/** An active owner always wins over newer terminal records. Never guess between two writers. */
export function sessionOwner(session: SessionRecord, agents: AgentRecord[]): AgentRecord | undefined {
  const owners = agents.filter(agent => agent.sessionId === session.id);
  if (owners.some(agent => key(agent.cwd) !== key(session.cwd))) throw new Error('Session Agent workspace mismatch; no worker attached');
  const active = owners.filter(agent => ['working', 'queued', 'waiting_for_input'].includes(agent.status));
  if (active.length > 1) throw new Error('Multiple active Agents own this conversation; stop the conflicting workers before resuming');
  return active[0] ?? owners.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))[0];
}

export function forkResumeState(state: SessionRecord['resume'], owner?: AgentRecord): SessionRecord['resume'] {
  if (!state && !owner) return undefined;
  return { ...(state ?? { version: 1 as const, role: owner!.role }), ...(owner ? {
    role: owner.role, planMode: Boolean(owner.planMode || owner.pendingPlanId),
    ...(owner.allowedTools ? { allowedTools: [...owner.allowedTools] } : {}),
    ...(owner.deniedTools ? { deniedTools: [...owner.deniedTools] } : {}),
    ...(owner.profileName ? { profileName: owner.profileName } : {}),
  } : {}) };
}

/** Complete the protocol record, never the operation: interrupted tools are not replayed. */
export function reconcileInterruptedTools(messages: ModelMessage[]): { messages: ModelMessage[]; repaired: number } {
  const output: ModelMessage[] = []; const pending = new Map<string, string>(); let repaired = 0;
  const flush = (): void => {
    if (!pending.size) return;
    output.push({ role: 'user', content: [...pending].map(([id, name]) => ({ type: 'tool_result' as const, tool_use_id: id, is_error: true,
      content: `[Interrupted tool: ${name}] The previous process ended without recording a result. Execution outcome is UNKNOWN, not a confirmed failure. Check files/processes/external state before deciding whether a retry is safe. This recovery record did not execute or replay the tool.` })) });
    repaired += pending.size; pending.clear();
  };
  for (const message of messages) {
    const results = message.role === 'user' && Array.isArray(message.content) ? message.content.filter(block => block.type === 'tool_result') : [];
    if (message.role === 'assistant' || !results.length) flush();
    output.push(message);
    if (message.role === 'assistant' && Array.isArray(message.content)) for (const block of message.content) if (block.type === 'tool_use' && block.id) pending.set(block.id, block.name ?? 'tool');
    for (const result of results) if (result.tool_use_id) pending.delete(result.tool_use_id);
  }
  flush(); return { messages: output, repaired };
}
