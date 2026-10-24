import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { projectStateDir } from './paths.js';
import { createId, readJson, withFileLock, writeJson } from './storage.js';
export type ProjectTopic = 'plans' | 'teams' | 'agents' | 'tasks' | 'inbox' | 'workspace' | 'notifications';
interface Event { sequence: number; topic: ProjectTopic; at: string }
interface Journal { generation: string; sequence: number; events: Event[]; committed?: Record<string, { generation: string; sequence: number }> }
export function committedProducerTopic(producer: string): ProjectTopic | undefined {
  if (producer === 'plans' || producer === 'notifications') return producer;
  const match = /^(tasks:task|teams:team|agents:agent|inbox:agent)_[a-f0-9]{16}$/.exec(producer);
  return match ? producer.split(':')[0] as ProjectTopic : undefined;
}
const topics = new Set(['plans','teams','agents','tasks','inbox','workspace','notifications']);
const pathFor = (cwd: string) => join(projectStateDir(cwd), 'ide-events.json');
async function safe(cwd: string) {
  if (!(await lstat(cwd)).isDirectory()) throw new Error('Project event workspace must exist');
  for (const path of [projectStateDir(cwd), pathFor(cwd)]) {
    try { const info = await lstat(path); if (info.isSymbolicLink() || info.isFile() && info.size > 2_000_000) throw new Error('Invalid project event state'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
async function load(cwd: string): Promise<Journal> {
  await safe(cwd);
  const value = await readJson<Journal>(pathFor(cwd), { generation: createId('events'), sequence: 0, events: [] });
  if (!/^events_[a-f0-9]{16}$/.test(value?.generation) || !Number.isSafeInteger(value.sequence) || value.sequence < 0 || !Array.isArray(value.events) || value.events.length > 1024 || value.events.some((event, i) => !event || event.sequence !== value.sequence - value.events.length + i + 1 || !topics.has(event.topic) || !Number.isFinite(Date.parse(event.at)))) throw new Error('Project event journal is invalid; refresh snapshots before acting');
  if (value.committed !== undefined && (!value.committed || typeof value.committed !== 'object' || Array.isArray(value.committed) || Object.keys(value.committed).length > 4096 || Object.entries(value.committed).some(([name, row]) => !committedProducerTopic(name) || !row || !/^outbox_[a-f0-9]{16}$/.test(row.generation) || !Number.isSafeInteger(row.sequence) || row.sequence < 1))) throw new Error('Invalid committed event checkpoints');
  return value;
}
/** Durable invalidation, not a claim that a mutation committed or a permission
 * grant. Producers write intent before mutation; consumers always reread state. */
export async function publishProjectInvalidation(cwd: string, topic: ProjectTopic) {
  if (!topics.has(topic)) throw new Error('Unknown project event topic');
  await safe(cwd);
  return withFileLock(pathFor(cwd) + '.lock', async () => {
    const journal = await load(cwd);
    if (journal.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Project event sequence exhausted');
    journal.events.push({ sequence: ++journal.sequence, topic, at: new Date().toISOString() });
    journal.events = journal.events.slice(-1024);
    await writeJson(pathFor(cwd), journal);
    return `${journal.generation}:${journal.sequence}`;
  });
}
/** Snapshot producers call only AFTER committing their snapshot+intent together.
 * These checkpoints survive event-ring eviction, so an ack crash cannot duplicate
 * a committed invalidation. They are NOT execution/approval capabilities. */
export async function publishCommittedInvalidation(cwd: string, producer: string, generation: string, sequence: number, at: string, topic: ProjectTopic) {
  if (!committedProducerTopic(producer) || topic !== committedProducerTopic(producer) || !/^outbox_[a-f0-9]{16}$/.test(generation) || !Number.isSafeInteger(sequence) || sequence < 1 || !Number.isFinite(Date.parse(at))) throw new Error('Invalid committed invalidation');
  await safe(cwd);
  return withFileLock(pathFor(cwd) + '.lock', async () => {
    const journal = await load(cwd), previous = journal.committed?.[producer];
    if (previous && previous.generation !== generation) throw new Error('Outbox generation changed; inspect restored state before delivery');
    if (previous && sequence <= previous.sequence) return { duplicate: true };
    if (previous && sequence !== previous.sequence + 1) throw new Error('Committed event sequence gap; inspect outbox');
    if (!previous && Object.keys(journal.committed ?? {}).length >= 4096) throw new Error('Committed producer checkpoint capacity reached; operator archive required');
    if (journal.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Project event sequence exhausted');
    journal.events.push({ sequence: ++journal.sequence, topic, at });
    journal.events = journal.events.slice(-1024);
    (journal.committed ??= {})[producer] = { generation, sequence };
    await writeJson(pathFor(cwd), journal);
    return { duplicate: false };
  });
}
export async function projectEventsAfter(cwd: string, cursor?: string, limit = 100) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Event limit must be 1–200');
  const delivery = await (await import('./projectOutbox.js')).recoverProjectOutboxes(cwd);
  const journal = await load(cwd);
  let sequence = 0, reset = false;
  if (cursor !== undefined) {
    const match = /^(events_[a-f0-9]{16}):(\d{1,16})$/.exec(cursor);
    if (!match || !Number.isSafeInteger(Number(match[2]))) throw new Error('Invalid project event cursor');
    sequence = Number(match[2]);
    reset = match[1] !== journal.generation || sequence > journal.sequence || sequence < (journal.events[0]?.sequence ?? 1) - 1;
    if (reset) sequence = 0;
  }
  const events = journal.events.filter(event => event.sequence > sequence).slice(0, limit);
  const next = events.at(-1)?.sequence ?? journal.sequence;
  return { events: events.map(event => ({ sequence: event.sequence, topic: event.topic, at: event.at, cursor: `${journal.generation}:${event.sequence}` })), cursor: `${journal.generation}:${next}`, reset, hasMore: next < journal.sequence, replayIsAuthorization: false, delivery };
}
