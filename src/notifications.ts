import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { projectStateDir } from './paths.js';
import { createId, readJson, withFileLock, writeJson } from './storage.js';
import { enqueueCommit, deliverCommits, outboxSummary, validateCommitOutbox, type CommitOutbox } from './commitOutbox.js';

export interface ProjectNotification {
  id: string; title: string; body: string; level: 'info' | 'success' | 'warning' | 'error';
  createdAt: string; agentId?: string; readAt?: string; sourceKey?: string;
}
const file = (cwd: string) => join(projectStateDir(cwd), 'notifications.json');
const levels = ['info','success','warning','error'];
const digest = (rows: ProjectNotification[]) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
interface NotificationState { format: 1; rows: ProjectNotification[]; outbox?: CommitOutbox }
async function loadState(cwd: string): Promise<NotificationState> {
  const directory = projectStateDir(cwd);
  for (const path of [directory, file(cwd)]) {
    try { const info = await lstat(path); if (info.isSymbolicLink() || (path === file(cwd) && (!info.isFile() || info.size > 8_000_000))) throw new Error('Invalid notification state path/size'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const stored: unknown = await readJson(file(cwd), []);
  const envelope = stored as NotificationState;
  const value = Array.isArray(stored) ? stored : envelope?.format === 1 ? envelope.rows : undefined;
  const outbox = Array.isArray(stored) ? undefined : envelope?.outbox;
  validateCommitOutbox(outbox);
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid notification collection');
  const ids = new Set<string>();
  const rows = value.map(row => {
    if (!row || typeof row !== 'object' || !/^notification_[a-f0-9]{16}$/.test(row.id) || ids.has(row.id)
      || typeof row.title !== 'string' || row.title.length > 200 || typeof row.body !== 'string' || row.body.length > 10000
      || !levels.includes(row.level) || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))
      || (row.agentId !== undefined && typeof row.agentId !== 'string')
      || (row.sourceKey !== undefined && (typeof row.sourceKey !== 'string' || row.sourceKey.length > 200))
      || (row.readAt !== undefined && (typeof row.readAt !== 'string' || !Number.isFinite(Date.parse(row.readAt))))) throw new Error('Invalid notification record');
    ids.add(row.id);
    // Deliberately project fields: unknown stored data is never returned to IDE/CLI.
    return { id:row.id, title:row.title, body:row.body, level:row.level, createdAt:row.createdAt,
      ...(row.agentId ? { agentId:row.agentId } : {}), ...(row.readAt ? { readAt:row.readAt } : {}), ...(row.sourceKey ? { sourceKey:row.sourceKey } : {}) };
  });
  return { format: 1, rows, ...(outbox ? { outbox } : {}) };
}
async function load(cwd: string) { return (await loadState(cwd)).rows; }
async function commit(cwd: string, state: NotificationState) {
  await writeJson(file(cwd), state);
  try { await deliverCommits(cwd, 'notifications', state.outbox); await writeJson(file(cwd), state); } catch { /* committed intent remains pending */ }
}
export async function recoverNotificationOutbox(cwd: string) {
  const initial = await loadState(cwd);
  if (!initial.outbox?.pending.length) return { delivered: 0, ...outboxSummary(initial.outbox) };
  return withFileLock(file(cwd)+'.lock', async () => {
    const state = await loadState(cwd), delivered = await deliverCommits(cwd, 'notifications', state.outbox);
    await writeJson(file(cwd), state);
    return { delivered, ...outboxSummary(state.outbox) };
  });
}
export async function listProjectNotifications(cwd: string, options: { offset?: number; limit?: number; unreadOnly?: boolean } = {}) {
  const { offset = 0, limit = 50, unreadOnly = false } = options;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 500 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid notification page bounds');
  const rows = await load(cwd), selected = rows.filter(row => !unreadOnly || !row.readAt).reverse();
  return { items:selected.slice(offset,offset+limit), total:selected.length, unread:rows.filter(row=>!row.readAt).length, version:digest(rows), nextOffset:offset+limit < selected.length ? offset+limit : null };
}
export async function createProjectNotification(cwd: string, input: { title:string; body:string; level?:ProjectNotification['level']; agentId?:string; sourceKey?:string }) {
  if (typeof input.title !== 'string' || typeof input.body !== 'string' || !levels.includes(input.level ?? 'info') || (input.sourceKey !== undefined && (typeof input.sourceKey !== 'string' || input.sourceKey.length > 200))) throw new Error('Invalid notification input');
  await load(cwd); // Check links before opening a lock or creating state.
  return withFileLock(file(cwd)+'.lock', async () => {
    const state = await loadState(cwd), rows = state.rows, previous = input.sourceKey ? rows.find(row=>row.sourceKey===input.sourceKey) : undefined;
    if (previous) return previous;
    state.outbox = enqueueCommit(state.outbox);
    const item: ProjectNotification = { id:createId('notification'), title:input.title.slice(0,200), body:input.body.slice(0,10000), level:input.level ?? 'info', createdAt:new Date().toISOString(), ...(input.agentId ? {agentId:input.agentId} : {}), ...(input.sourceKey ? {sourceKey:input.sourceKey} : {}) };
    state.rows = [...rows,item].slice(-500);
    await commit(cwd,state); return item;
  });
}
/** CAS acknowledgement of only explicitly selected IDs; never mark later arrivals. */
export async function markProjectNotificationsRead(cwd: string, ids: string[], expectedVersion: string) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some(id=>typeof id !== 'string' || !/^notification_[a-f0-9]{16}$/.test(id)) || !/^[a-f0-9]{64}$/.test(expectedVersion)) throw new Error('Select 1–100 notification IDs and provide their current version');
  await load(cwd);
  return withFileLock(file(cwd)+'.lock', async () => {
    const state = await loadState(cwd), rows = state.rows;
    if (digest(rows)!==expectedVersion) throw new Error('Notifications changed; refresh before marking read');
    const selected = new Set(ids); if ([...selected].some(id=>!rows.some(row=>row.id===id))) throw new Error('Notification is not in this workspace');
    const at = new Date().toISOString(), next = rows.map(row=>selected.has(row.id) && !row.readAt ? {...row,readAt:at} : row);
    state.outbox = enqueueCommit(state.outbox); state.rows = next;
    await commit(cwd,state);
    return { acknowledged:[...selected], version:digest(next), grantsPermission:false };
  });
}
