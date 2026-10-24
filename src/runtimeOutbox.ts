import { lstat, opendir, readFile } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { join, relative, resolve, sep } from 'node:path';
import { homeStateDir } from './paths.js';
import { writeJson, withFileLock } from './storage.js';
import { enqueueCommit, deliverCommits, validateCommitOutbox, type CommitOutbox, type CommitProducer } from './commitOutbox.js';

type Topic = 'tasks' | 'teams' | 'agents' | 'inbox';
interface Delivery { format: 1; producer: CommitProducer; targets: Array<{ cwd: string; outbox: CommitOutbox }> }
type Snapshot = Record<string, unknown> & { _projectDelivery?: Delivery };
const deliveryDisabled = new AsyncLocalStorage<boolean>();
export function runtimeDeliveryEnabled(): boolean { return deliveryDisabled.getStore() !== true; }
/** Ephemeral print state must never create persistent project invalidations. */
export function withoutRuntimeDelivery<T>(action: () => T): T { return deliveryDisabled.run(true, action); }
const same = (a: string, b: string) => process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
/** Home snapshots are private state. Never follow state-directory junctions while
 * recovering, and never call listAgents (which may reconcile worker lifetimes). */
async function safe(path: string) {
  const root = resolve(homeStateDir()), suffix = relative(root, resolve(path));
  if (suffix === '..' || suffix.startsWith(`..${sep}`) || resolve(root, suffix) !== resolve(path)) throw new Error('Runtime snapshot escapes home');
  let part = root;
  for (const name of ['', ...suffix.split(sep).filter(Boolean)]) {
    if (name) part = join(part, name);
    try { if ((await lstat(part)).isSymbolicLink()) throw new Error('Runtime state links are not allowed'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}
export async function readRuntimeSnapshot(path: string): Promise<Snapshot | undefined> {
  await safe(path);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > 8_000_000) throw new Error('Runtime snapshot size/type invalid');
    const bytes = await readFile(path);
    if (bytes.length > 8_000_000) throw new Error('Runtime snapshot grew beyond limit');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    // Legacy mailboxes are arrays; their first mutation performs envelope migration.
    if (Array.isArray(value)) return { messages: value };
    if (!value || typeof value !== 'object') throw new Error('Invalid runtime snapshot');
    return value as Snapshot;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
function delivery(value: Snapshot | undefined): Delivery | undefined {
  const stored = value?._projectDelivery;
  if (stored === undefined) return;
  if (!stored || stored.format !== 1 || !/^(tasks:task|teams:team|agents:agent|inbox:agent)_[a-f0-9]{16}$/.test(stored.producer)
    || !Array.isArray(stored.targets) || stored.targets.length < 1 || stored.targets.length > 2) throw new Error('Invalid runtime delivery binding');
  const seen: string[] = [];
  for (const row of stored.targets) {
    if (!row || typeof row.cwd !== 'string' || row.cwd !== resolve(row.cwd) || seen.some(cwd => same(cwd, row.cwd))) throw new Error('Invalid runtime delivery workspace');
    validateCommitOutbox(row.outbox); if (!row.outbox) throw new Error('Missing runtime delivery queue');
    seen.push(row.cwd);
  }
  return structuredClone(stored);
}
export function publicRuntimeSnapshot<T>(value: Snapshot): T {
  const { _projectDelivery, ...record } = value;
  return record as T;
}
/** Caller holds the SAME lock used by recovery. Record+intent share one atomic
 * snapshot. Delivery errors never turn a committed business change into a retry. */
export async function commitRuntimeSnapshot(path: string, topic: Topic, id: string, record: object, cwds: string[], changed = true): Promise<void> {
  const previous = await readRuntimeSnapshot(path), prior = delivery(previous), producer = `${topic}:${id}` as CommitProducer;
  if (!/^(tasks:task|teams:team|agents:agent|inbox:agent)_[a-f0-9]{16}$/.test(producer)) throw new Error('Invalid runtime producer ID');
  const targets = [...new Set((runtimeDeliveryEnabled() ? cwds : []).map(cwd => resolve(cwd)))].filter((cwd, i, rows) => rows.findIndex(other => same(other, cwd)) === i);
  if (targets.length > 2 || prior && (prior.producer !== producer || prior.targets.length !== targets.length || prior.targets.some(row => !targets.some(cwd => same(cwd, row.cwd))))) throw new Error('Runtime workspace binding changed; operator migration required');
  let next = prior;
  if (changed && targets.length) next = { format: 1, producer, targets: targets.map(cwd => ({ cwd, outbox: enqueueCommit(prior?.targets.find(row => same(row.cwd, cwd))?.outbox) })) };
  const clean = publicRuntimeSnapshot<Record<string, unknown>>(record as Snapshot);
  const stored: Snapshot = { ...clean, ...(next ? { _projectDelivery: next } : {}) };
  await safe(path); await writeJson(path, stored);
  if (next) {
    try { for (const row of next.targets) await deliverCommits(row.cwd, producer, row.outbox); await writeJson(path, stored); }
    catch { /* Original committed intent is still on disk; no business replay. */ }
  }
}

/** Bounded discovery of known record locations only. Checkpoints are capped at
 * 4096 and NEVER evicted, preserving dedup after the visible event ring rolls. */
export async function recoverRuntimeOutboxes(cwd: string) {
  const root = homeStateDir(), candidates: Array<{ path: string; lock: string; topic: Topic; id: string }> = [];
  let entries = 0, bytes = 0;
  async function names(directory: string) {
    await safe(directory); const values: string[] = [];
    let handle; try { handle = await opendir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return values; throw error; }
    try { for await (const entry of handle) { if (++entries > 8192) throw new Error('Runtime recovery discovery capacity exceeded'); values.push(entry.name); } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return values;
  }
  for (const topic of ['tasks', 'teams', 'agents'] as const) {
    const prefix = topic === 'tasks' ? 'task' : topic === 'teams' ? 'team' : 'agent';
    for (const name of await names(join(root, topic))) {
      if (!new RegExp(`^${prefix}_[a-f0-9]{16}\\.json$`).test(name)) continue;
      const id = name.slice(0, -5), path = join(root, topic, name);
      candidates.push({ path, id, topic, lock: topic === 'tasks' ? join(root, 'locks', `task-${id}.lock`) : topic === 'teams' ? join(root, 'teams', 'registry.lock') : `${path}.lock` });
    }
  }
  for (const session of await names(join(root, 'teams'))) if (/^session_[a-f0-9]{16}$/.test(session)) {
    const directory = join(root, 'teams', session, 'mailboxes');
    for (const name of await names(directory)) if (/^agent_[a-f0-9]{16}\.json$/.test(name)) {
      const path = join(directory, name); candidates.push({ path, id: name.slice(0, -5), topic: 'inbox', lock: `${path}.lock` });
    }
  }
  if (candidates.length > 4096) throw new Error('Runtime recovery record capacity exceeded');
  let delivered = 0, failed = 0, pending = 0;
  for (const item of candidates) {
    try {
      await safe(item.path); bytes += (await lstat(item.path)).size;
      if (bytes > 64_000_000) throw new Error('Runtime recovery byte capacity exceeded');
      const initial = delivery(await readRuntimeSnapshot(item.path));
      if (!initial?.targets.some(row => same(row.cwd, cwd) && row.outbox.pending.length)) continue;
      await safe(item.lock);
      await withFileLock(item.lock, async () => {
        const record = await readRuntimeSnapshot(item.path), value = delivery(record);
        if (!record || !value || value.producer !== `${item.topic}:${item.id}`) throw new Error('Runtime recovery identity mismatch');
        for (const row of value.targets.filter(row => same(row.cwd, cwd))) {
          pending += row.outbox.pending.length;
          delivered += await deliverCommits(row.cwd, value.producer, row.outbox);
        }
        record._projectDelivery = value; await writeJson(item.path, record);
      });
    } catch { failed++; }
    if (bytes > 64_000_000) break;
  }
  return { delivered, failed, pending: Math.max(0, pending - delivered), capacity: 4096, businessOperationsReplayed: 0 };
}
