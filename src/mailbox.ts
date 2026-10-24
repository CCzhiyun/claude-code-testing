import { join } from 'node:path';
import { homeStateDir } from './paths.js';
import { createId, readJson, withFileLock, writeJson } from './storage.js';
import type { AgentRecord, TeamMessage } from './types.js';
import { commitRuntimeSnapshot, readRuntimeSnapshot } from './runtimeOutbox.js';

async function messagesAt(path: string): Promise<TeamMessage[]> {
  const state = await readRuntimeSnapshot(path);
  const messages = state?.messages ?? [];
  if (!Array.isArray(messages) || messages.length > 2000) throw new Error('Invalid mailbox snapshot');
  return messages as TeamMessage[];
}
async function commitMailbox(path: string, recipient: AgentRecord, messages: TeamMessage[]) {
  const id = recipient.teamSessionId ?? recipient.sessionId;
  validateId(id, 'session');
  const session = await readJson<{ cwd?: string } | null>(join(homeStateDir(), 'sessions', `${id}.json`), null);
  await commitRuntimeSnapshot(path, 'inbox', recipient.id, { format: 1, messages }, [recipient.cwd, ...(session?.cwd ? [session.cwd] : [])]);
}

function validateId(value: string, kind: 'agent' | 'session'): void {
  const pattern = kind === 'agent' ? /^agent_[a-f0-9]{16}$/ : /^session_[a-f0-9]{16}$/;
  if (!pattern.test(value)) throw new Error(`Invalid ${kind} id: ${value}`);
}

function inboxPath(teamSessionId: string, agentId: string): string {
  validateId(teamSessionId, 'session');
  validateId(agentId, 'agent');
  return join(homeStateDir(), 'teams', teamSessionId, 'mailboxes', `${agentId}.json`);
}

async function teamAgent(agentId: string, teamSessionId: string): Promise<AgentRecord> {
  const { loadAgent } = await import('./agent.js');
  const agent = await loadAgent(agentId);
  if ((agent.teamSessionId ?? agent.sessionId) !== teamSessionId) throw new Error(`Agent is outside team ${teamSessionId}: ${agentId}`);
  return agent;
}

export async function discoverTeam(teamSessionId: string): Promise<Array<Pick<AgentRecord, 'id' | 'parentId' | 'role' | 'goal' | 'status' | 'sessionId' | 'taskId'>>> {
  validateId(teamSessionId, 'session');
  const { listAgents } = await import('./agent.js');
  return (await listAgents()).filter((agent) => (agent.teamSessionId ?? agent.sessionId) === teamSessionId)
    .map(({ id, parentId, role, goal, status, sessionId, taskId }) => ({ id, ...(parentId ? { parentId } : {}), role, goal, status, sessionId, ...(taskId ? { taskId } : {}) }));
}

export async function sendTeamMessage(options: {
  teamSessionId: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  kind?: TeamMessage['kind'];
}): Promise<TeamMessage> {
  const sender = await teamAgent(options.fromAgentId, options.teamSessionId);
  const recipient = await teamAgent(options.toAgentId, options.teamSessionId);
  if (options.kind === 'permission_response') throw new Error('Agent mailboxes cannot grant human permissions');
  if (options.kind === 'shutdown_request' && (sender.parentId || sender.sessionId !== options.teamSessionId || options.toAgentId === sender.id)) throw new Error('Only the root lead can request teammate shutdown');
  if (!options.content.trim()) throw new Error('Team message cannot be empty');
  const message: TeamMessage = {
    id: createId('message'),
    teamSessionId: options.teamSessionId,
    fromAgentId: options.fromAgentId,
    toAgentId: options.toAgentId,
    kind: options.kind ?? 'message',
    content: options.content.slice(0, 100_000),
    createdAt: new Date().toISOString(),
    read: false,
  };
  const path = inboxPath(options.teamSessionId, options.toAgentId);
  await withFileLock(`${path}.lock`, async () => {
    const messages = await messagesAt(path);
    messages.push(message);
    await commitMailbox(path, recipient, messages.slice(-2_000));
  });
  return message;
}

export async function readTeamMailbox(options: {
  teamSessionId: string;
  agentId: string;
  unreadOnly?: boolean;
  markRead?: boolean;
}): Promise<TeamMessage[]> {
  const recipient = await teamAgent(options.agentId, options.teamSessionId);
  const path = inboxPath(options.teamSessionId, options.agentId);
  if (options.markRead === false) {
    const messages = await messagesAt(path);
    return options.unreadOnly === false ? messages : messages.filter(message => !message.read);
  }
  return withFileLock(`${path}.lock`, async () => {
    const messages = await messagesAt(path);
    const selected = options.unreadOnly === false ? messages : messages.filter((message) => !message.read);
    if (options.markRead !== false && selected.length > 0) {
      // Shutdown is a structured worker control, not a model-consumable notification.
      const ids = new Set(selected.filter((message) => message.kind !== 'shutdown_request').map((message) => message.id));
      if (ids.size) await commitMailbox(path, recipient, messages.map((message) => ids.has(message.id) ? { ...message, read: true } : message));
    }
    return selected;
  });
}

export function formatTeamMessages(messages: TeamMessage[]): string {
  return messages.map((message) => `[${message.kind} from ${message.fromAgentId} at ${message.createdAt}]\n${message.content}`).join('\n\n');
}

/** Each delivery is independently durable; partial failures are reported explicitly. */
export async function broadcastTeamMessage(options: { teamSessionId: string; fromAgentId: string; content: string }): Promise<{ delivered: TeamMessage[]; failed: Array<{ agentId: string; error: string }> }> {
  await teamAgent(options.fromAgentId, options.teamSessionId);
  const delivered: TeamMessage[] = []; const failed: Array<{ agentId: string; error: string }> = [];
  for (const member of await discoverTeam(options.teamSessionId)) {
    if (member.id === options.fromAgentId || member.status === 'cancelled') continue;
    try { delivered.push(await sendTeamMessage({ ...options, toAgentId: member.id })); }
    catch (error) { failed.push({ agentId: member.id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { delivered, failed };
}

export async function requestTeamShutdown(options: { teamSessionId: string; fromAgentId: string; toAgentId: string }): Promise<TeamMessage> {
  const message = await sendTeamMessage({ ...options, kind: 'shutdown_request', content: 'Lead requested cooperative shutdown. Preserve files, conversation and pending results; do not start additional work.' });
  const { loadAgent, cancelAgent } = await import('./agent.js');
  const member = await loadAgent(options.toAgentId);
  if (!['working', 'queued'].includes(member.status)) {
    await cancelAgent(member.id);
    await acknowledgeTeamShutdown(message, 'No active turn; conversation preserved.');
  }
  return message;
}

/** Consume only the authenticated control after its durable acknowledgement, so a later human resume is not cancelled again. */
export async function acknowledgeTeamShutdown(request: TeamMessage, detail: string): Promise<void> {
  const sender = await teamAgent(request.fromAgentId, request.teamSessionId);
  await teamAgent(request.toAgentId, request.teamSessionId);
  if (request.kind !== 'shutdown_request' || sender.parentId || sender.sessionId !== request.teamSessionId || sender.id === request.toAgentId) throw new Error('Invalid lead shutdown control');
  const path = inboxPath(request.teamSessionId, request.toAgentId);
  await withFileLock(`${path}.lock`, async () => {
    const messages = await messagesAt(path);
    const stored = messages.find((item) => item.id === request.id && item.kind === 'shutdown_request' && item.fromAgentId === sender.id && item.toAgentId === request.toAgentId);
    if (!stored) throw new Error('Shutdown control is not in the recipient mailbox');
    if (stored.read) return;
    await sendTeamMessage({ teamSessionId: request.teamSessionId, fromAgentId: request.toAgentId, toAgentId: sender.id, kind: 'status', content: `Shutdown acknowledged: ${request.toAgentId}. ${detail}` });
    stored.read = true;
    const recipient = await teamAgent(request.toAgentId, request.teamSessionId);
    await commitMailbox(path, recipient, messages);
  });
}

/** Worker poll, outside model inference. Message text cannot trigger this control path. */
export async function pendingLeadShutdown(agent: AgentRecord): Promise<TeamMessage | undefined> {
  const teamSessionId = agent.teamSessionId ?? agent.sessionId;
  const messages = await readTeamMailbox({ teamSessionId, agentId: agent.id, unreadOnly: true, markRead: false });
  for (const message of messages.filter((item) => item.kind === 'shutdown_request')) {
    const sender = await teamAgent(message.fromAgentId, teamSessionId);
    if (!sender.parentId && sender.sessionId === teamSessionId && sender.id !== agent.id) return message;
  }
  return undefined;
}
