import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelMessage, SessionRecord, PlatformConfig } from './types.js';
import {countModelText} from './textTokenizer.js';
import { homeStateDir } from './paths.js';
import { createId, readJson, writeJson } from './storage.js';
import { estimateTokens } from './tokenUsage.js';
import { contextMessages } from './contextBudget.js';
import { sessionGitIdentity } from './sessionGit.js';
import { forkResumeState, sessionOwner } from './sessionRecovery.js';
import { rebaseCompactedResponses } from './responseHistory.js';

function pathFor(id: string): string {
  if (!/^session_[a-f0-9]{16}$/.test(id)) throw new Error(`Invalid session id: ${id}`);
  return join(homeStateDir(), 'sessions', `${id}.json`);
}

export async function createSession(title: string, cwd: string, parentId?: string): Promise<SessionRecord> {
  const now = new Date().toISOString();
  const session: SessionRecord = {
    id: createId('session'),
    ...(parentId ? { parentId } : {}),
    title,
    cwd,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  const git = await sessionGitIdentity(cwd);
  if (git) session.git = git;
  await saveSession(session);
  return session;
}

export async function loadSession(id: string): Promise<SessionRecord> {
  const session = await readJson<SessionRecord | null>(pathFor(id), null);
  if (!session) throw new Error(`Session not found: ${id}`);
  return session;
}

export async function saveSession(session: SessionRecord): Promise<void> {
  session.updatedAt = new Date().toISOString();
  await writeJson(pathFor(session.id), session);
}

export async function renameSession(id: string, title: string): Promise<SessionRecord> {
  const name = title.trim();
  if (!name || Array.from(name).length > 120 || /[\x00-\x1f\x7f-\x9f\u001b]/.test(name)) throw new Error('Session name must be 1–120 characters without control characters');
  await assertSessionIdle(id);
  const session = await loadSession(id);
  session.title = name;
  await saveSession(session);
  return session;
}

export async function appendMessages(id: string, messages: ModelMessage[]): Promise<SessionRecord> {
  const session = await loadSession(id);
  session.messages.push(...messages);
  await saveSession(session);
  return session;
}

export async function forkSession(id: string, title?: string): Promise<SessionRecord> {
  const source = await loadSession(id);
  const { listAgents } = await import('./agent.js');
  const resume = forkResumeState(source.resume, sessionOwner(source, await listAgents()));
  const fork = await createSession(title ?? `${source.title} (fork)`, source.cwd, source.id);
  fork.messages = structuredClone(source.messages);
  if (source.archivedMessages) fork.archivedMessages = structuredClone(source.archivedMessages);
  if (source.summary) fork.summary = source.summary;
  if (source.compaction) fork.compaction = structuredClone(source.compaction);
  if (resume) fork.resume = structuredClone(resume);
  await saveSession(fork);
  return fork;
}

export async function listSessions(): Promise<SessionRecord[]> {
  const directory = join(homeStateDir(), 'sessions');
  let names: string[];
  try { names = await readdir(directory); } catch { return []; }
  const sessions = await Promise.all(names.filter((name) => name.endsWith('.json')).map(async (name) =>
    readJson<SessionRecord | null>(join(directory, name), null)));
  return sessions.filter((item): item is SessionRecord => item !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function compactMessages(messages: ModelMessage[], maxTokens: number): ModelMessage[] {
  const cut = chooseCut(messages, maxTokens * 0.7);
  return cut === 0 ? [...messages] : rebaseCompactedResponses(messages, [{ role: 'user', content: `[Context compacted: ${cut} older messages are retained in the session transcript.]` }, ...messages.slice(cut)]);
}

function messageText(message: ModelMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.map((block) => block.text ?? block.content ?? (block.name ? `[tool ${block.name}]` : '')).join('\n');
}

export function isSummaryMessage(message: ModelMessage): boolean {
  return typeof message.content === 'string' && message.content.startsWith('[Earlier conversation summary]');
}

/** Cut only before an ordinary user turn: tool calls and all their results stay together. */
function chooseCut(messages: ModelMessage[], budget: number, count:(value:unknown)=>number=estimateTokens): number {
  if (count(contextMessages(messages)) <= budget) return 0;
  const suffix = new Array<number>(messages.length + 1).fill(0);
  for (let index = messages.length - 1; index >= 0; index--) suffix[index] = suffix[index + 1]! + count(contextMessages([messages[index]!])[0]);
  let lastSafe = 0;
  for (let index = 1; index < messages.length; index++) {
    const message = messages[index]!;
    if (message.role !== 'user' || (Array.isArray(message.content) && message.content.some((block) => block.type === 'tool_result'))) continue;
    lastSafe = index;
    if (suffix[index]! <= budget) return index;
  }
  // Never truncate the current user turn, even when it alone exceeds the budget.
  return lastSafe;
}

function tokenPrefix(text: string, budget: number, count:(value:unknown)=>number): string {
  const chars = Array.from(text);
  let low = 0, high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (count(chars.slice(0, mid).join('')) <= budget) low = mid; else high = mid - 1;
  }
  return chars.slice(0, low).join('');
}

function boundedExcerpts(text: string, budget: number, count:(value:unknown)=>number): string {
  if (count(text) <= budget) return text;
  const marker = '\n[Excerpts omitted; full transcript retained on disk]\n';
  const available = Math.max(0, budget - count(marker));
  const head = tokenPrefix(text, available * 0.6,count);
  const tail = Array.from(tokenPrefix(Array.from(text).reverse().join(''), available * 0.4,count)).reverse().join('');
  return `${head}${marker}${tail}`;
}

export function compactSession(session: SessionRecord, maxTokens: number, options: { force?: boolean; model?:PlatformConfig['model'] } = {}): SessionRecord {
  const count=(value:unknown)=>countModelText(options.model,value);
  const current = count(contextMessages(session.messages));
  const budget = Math.max(0, Math.floor(Math.min(maxTokens * 0.7, options.force ? current * 0.55 : Infinity)));
  if (current <= budget) return session;
  const originals = session.messages.filter((message) => !isSummaryMessage(message));
  const summaryBudget = Math.min(2000, Math.floor(budget * 0.25));
  const cut = chooseCut(originals, Math.max(0, budget - summaryBudget - 64),count);
  if (cut === 0) return session;
  const removed = originals.slice(0, cut);
  const additions = removed.map((message) => `${message.role}: ${messageText(message).replace(/\s+/g, ' ').slice(0, 500)}`).join('\n');
  session.summary = boundedExcerpts(`${session.summary ? `${session.summary}\n` : ''}${additions}`, summaryBudget,count);
  session.archivedMessages = [...(session.archivedMessages ?? []), ...removed];
  session.compaction = { method: 'extractive', at: new Date().toISOString(), archivedMessages: session.archivedMessages.length };
  session.messages = rebaseCompactedResponses(session.messages, [{ role: 'user', content: `[Earlier conversation summary]\nExtractive excerpts, not a complete semantic summary.\n${session.summary}` }, ...originals.slice(cut)]);
  return session;
}

/** Chronological original messages, without synthetic compaction summaries. */
export function fullSessionMessages(session: SessionRecord): ModelMessage[] {
  return [...(session.archivedMessages ?? []), ...session.messages].filter((message) => !isSummaryMessage(message));
}

export async function assertSessionIdle(sessionId: string): Promise<void> {
  const { listAgents } = await import('./agent.js');
  const active = (await listAgents()).find((agent) => agent.sessionId === sessionId && ['working', 'queued', 'waiting_for_input'].includes(agent.status));
  if (active) throw new Error(`Session is active (${active.status}). Finish the pending question, wait for completion, or stop the Agent before changing conversation state.`);
}
