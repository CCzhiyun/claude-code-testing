import { mkdir, readFile, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from '../../paths.js';
import { listSessions } from '../../sessions.js';

const HOLDER_STALE_MS = 60 * 60 * 1000;
const lockPath = (): string => join(homeStateDir(), 'memory', '.consolidate-lock');
const processRunning = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

export async function readLastConsolidatedAt(): Promise<number> { try { return (await stat(lockPath())).mtimeMs; } catch { return 0; } }
export async function tryAcquireConsolidationLock(): Promise<number | null> {
  const path = lockPath(); let previous = 0; let holder: number | undefined;
  try { previous = (await stat(path)).mtimeMs; holder = Number.parseInt((await readFile(path, 'utf8')).trim(), 10); } catch { /* No lock. */ }
  if (previous && Date.now() - previous < HOLDER_STALE_MS && holder && processRunning(holder)) return null;
  await mkdir(join(homeStateDir(), 'memory'), { recursive: true });
  await writeFile(path, String(process.pid), { mode: 0o600 });
  return Number.parseInt((await readFile(path, 'utf8')).trim(), 10) === process.pid ? previous : null;
}
export async function rollbackConsolidationLock(previous: number): Promise<void> {
  try { if (!previous) await unlink(lockPath()); else { await writeFile(lockPath(), ''); await utimes(lockPath(), previous / 1000, previous / 1000); } } catch { /* Best effort. */ }
}
export async function listSessionsTouchedSince(sinceMs: number): Promise<string[]> { return (await listSessions()).filter((session) => Date.parse(session.updatedAt) > sinceMs).map((session) => session.id); }
export async function recordConsolidation(): Promise<void> { await mkdir(join(homeStateDir(), 'memory'), { recursive: true }); await writeFile(lockPath(), String(process.pid), { mode: 0o600 }); }
