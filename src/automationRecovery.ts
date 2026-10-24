import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { withFileLock, writeJson } from './storage.js';
import { projectStateDir } from './paths.js';
import type { RoutineDefinition, RoutineRun, Wakeup, GoalDefinition } from './automation.js';

export interface AutomationState { routines: RoutineDefinition[]; runs: RoutineRun[]; wakeups: Wakeup[]; goals: GoalDefinition[] }
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown) => typeof value === 'string' && value.length <= 200000;
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const inputs = (value: unknown) => object(value) && Object.values(value).every(text);

export function validateAutomationState(value: unknown): AutomationState {
  if (!object(value)) throw new Error('Invalid automation state; use wakeups repair to inspect recovery');
  const state: Record<string, unknown> = {};
  for (const name of ['routines', 'runs', 'wakeups', 'goals']) {
    const rows = value[name] === undefined ? [] : value[name];
    if (!Array.isArray(rows) || rows.length > 50000) throw new Error('Invalid automation collection');
    const seen = new Set<string>();
    for (const row of rows) {
      if (!object(row) || typeof row.id !== 'string' || !/^(routine|run|wakeup|goal)_[a-f0-9]{16}$/.test(row.id) || !row.id.startsWith(name === 'routines' ? 'routine_' : name === 'runs' ? 'run_' : name === 'wakeups' ? 'wakeup_' : 'goal_') || seen.has(row.id)) throw new Error('Invalid or duplicate automation record ID');
      seen.add(row.id);
      let valid = false;
      if (name === 'routines') valid = text(row.name) && text(row.prompt) && typeof row.enabled === 'boolean' && inputs(row.inputs) && date(row.createdAt) && date(row.updatedAt) && (row.schedule === undefined || text(row.schedule));
      if (name === 'runs') valid = text(row.routineId) && inputs(row.inputs) && date(row.startedAt) && ['queued','running','completed','failed'].includes(String(row.status)) && (row.finishedAt === undefined || date(row.finishedAt)) && (row.result === undefined || text(row.result)) && (row.error === undefined || text(row.error));
      if (name === 'wakeups') valid = text(row.sessionId) && text(row.prompt) && date(row.runAt) && ['scheduled','delivered','cancelled'].includes(String(row.status)) && (row.jobId === undefined || typeof row.jobId === 'string' && /^scheduler_[a-f0-9]{16}$/.test(row.jobId));
      if (name === 'goals') valid = text(row.sessionId) && text(row.objective) && inputs(row.inputs) && date(row.createdAt) && date(row.updatedAt) && ['active','paused','blocked','completed','cancelled'].includes(String(row.status)) && (row.version === undefined || Number.isSafeInteger(row.version) && Number(row.version) >= 1) && (row.reason === undefined || text(row.reason));
      if (!valid) throw new Error(`Invalid automation ${name} record`);
    }
    state[name] = rows;
  }
  return state as unknown as AutomationState;
}

async function boundedBytes(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 8 * 1024 * 1024) throw new Error('Automation recovery requires a regular file under 8 MiB');
  return readFile(path);
}
async function safeDirectory(path: string) {
  await mkdir(path, { recursive: true });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Automation state directory must not be a link');
}

/** Called under the existing automation lock. Write-ahead checkpoint preserves
 * the latest intended state; neither recovery nor inspection executes tasks. */
export async function writeAutomationJson(path: string, state: AutomationState): Promise<void> {
  validateAutomationState(state);
  await safeDirectory(dirname(path));
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) throw new Error('Automation state exceeds 8 MiB');
  await writeJson(`${path}.checkpoint`, { format: 1, digest: digest(serialized), state });
  await writeJson(path, state);
}

export async function repairAutomationState(cwd: string, options: { confirm?: boolean; expectedDigest?: string } = {}) {
  const path = join(projectStateDir(cwd), 'automation.json');
  const inspect = async () => {
    const directory = await lstat(dirname(path));
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Automation state directory must not be a link');
    const raw = await boundedBytes(path);
    let corrupt = false;
    try { validateAutomationState(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))); } catch { corrupt = true; }
    if (!corrupt) throw new Error('Automation state is valid; repair refused');
    const checkpointRaw = await boundedBytes(`${path}.checkpoint`);
    const checkpoint = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(checkpointRaw));
    if (checkpoint?.format !== 1 || checkpoint.digest !== digest(JSON.stringify(checkpoint.state))) throw new Error('Automation checkpoint integrity check failed');
    return { raw, checkpointRaw, state: validateAutomationState(checkpoint.state), expectedDigest: digest(raw), checkpointDigest: checkpoint.digest as string };
  };
  const preview = await inspect();
  if (!options.confirm) return { repaired: false as const, expectedDigest: preview.expectedDigest, checkpointDigest: preview.checkpointDigest, action: 'Review the checkpoint, then repeat with --confirm --expected-digest. Recovery pauses pending work; no external action is replayed.' };
  if (options.expectedDigest !== preview.expectedDigest) throw new Error('Automation state changed or expected digest missing; inspect repair again');
  await safeDirectory(dirname(path));
  return withFileLock(`${path}.lock`, async () => {
    const current = await inspect();
    if (current.expectedDigest !== preview.expectedDigest || current.checkpointDigest !== preview.checkpointDigest) throw new Error('Automation state/checkpoint changed during repair; inspect again');
    const directory = join(dirname(path), 'automation-recovery');
    await safeDirectory(directory);
    const backup = join(directory, randomUUID()); await safeDirectory(backup);
    await writeFile(join(backup, 'corrupt.json'), current.raw, { flag: 'wx', mode: 0o600 });
    await writeFile(join(backup, 'checkpoint.json'), current.checkpointRaw, { flag: 'wx', mode: 0o600 });
    for (const row of current.state.routines) row.enabled = false;
    for (const row of current.state.wakeups) if (row.status === 'scheduled') row.status = 'cancelled';
    for (const row of current.state.goals) if (['active','paused','blocked'].includes(row.status)) { row.status = 'cancelled'; row.version = (row.version ?? 1) + 1; row.updatedAt = new Date().toISOString(); }
    for (const row of current.state.runs) if (['queued','running'].includes(row.status)) { row.status = 'failed'; row.error = 'State recovered. Review external side effects before creating a new run.'; row.finishedAt = new Date().toISOString(); }
    await writeAutomationJson(path, current.state);
    return { repaired: true as const, backup, automaticReplay: false, pendingWorkPaused: true };
  });
}
