import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homeStateDir } from '../../paths.js';
import { listSessions } from '../../sessions.js';
import { assertTeamMemorySafe } from '../teamMemorySync/teamMemSecretGuard.js';
import { isAutoDreamEnabled } from './config.js';
import { buildConsolidationPrompt } from './consolidationPrompt.js';
import { readLastConsolidatedAt, recordConsolidation, rollbackConsolidationLock, tryAcquireConsolidationLock } from './consolidationLock.js';

let timer: ReturnType<typeof setInterval> | undefined;
export function initAutoDream(run: () => Promise<void>, intervalMs = 60 * 60 * 1000): () => void {
  if (!isAutoDreamEnabled()) return () => undefined;
  timer = setInterval(() => void run().catch(() => undefined), Math.max(60_000, intervalMs)); timer.unref?.();
  return () => { if (timer) clearInterval(timer); timer = undefined; };
}

export async function executeAutoDream(consolidate: (prompt: string) => Promise<string>, options: { minHours?: number; maxSessions?: number } = {}): Promise<{ updated: boolean; sessionCount: number }> {
  if (!isAutoDreamEnabled()) return { updated: false, sessionCount: 0 };
  const last = await readLastConsolidatedAt();
  if (Date.now() - last < (options.minHours ?? 12) * 3_600_000) return { updated: false, sessionCount: 0 };
  const prior = await tryAcquireConsolidationLock();
  if (prior === null) return { updated: false, sessionCount: 0 };
  try {
    const sessions = (await listSessions()).filter((session) => Date.parse(session.updatedAt) > last).slice(0, options.maxSessions ?? 20);
    if (!sessions.length) { await recordConsolidation(); return { updated: false, sessionCount: 0 }; }
    const path = join(homeStateDir(), 'memory', 'AUTO_MEMORY.md');
    let existing = ''; try { existing = await readFile(path, 'utf8'); } catch { /* First consolidation. */ }
    const memory = await consolidate(buildConsolidationPrompt(sessions, existing));
    assertTeamMemorySafe(memory);
    await writeFile(path, memory, { mode: 0o600 });
    await recordConsolidation();
    return { updated: true, sessionCount: sessions.length };
  } catch (error) { await rollbackConsolidationLock(prior); throw error; }
}
