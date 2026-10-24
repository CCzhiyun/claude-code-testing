import { createHash } from 'node:crypto';
import { lstat, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { readJson, withFileLock, writeJson } from './storage.js';

interface Receipt { schemaVersion: 1; key: string; status: 'running' | 'completed' | 'failed'; updatedAt: string }

/** Durable at-most-one automatic attempt. A crash/failure is ambiguous: never
 * silently repeat a hook that may already have performed an external action. */
export async function runHookOnce(cwd: string, identity: unknown, operation: () => Promise<void>): Promise<void> {
  const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  let directory = resolve(cwd);
  for (const component of ['.ccpt', 'hooks-once']) {
    directory = join(directory, component);
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Hook once state must not traverse a link');
  }
  const path = join(directory, `${key}.json`);
  await withFileLock(`${path}.lock`, async () => {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Hook once receipt must not be a link'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const previous = await readJson<Receipt | undefined>(path, undefined);
    if (previous !== undefined) {
      if (!previous || previous.schemaVersion !== 1 || previous.key !== key || previous.status !== 'completed') throw new Error(`Hook once attempt is incomplete or invalid; inspect receipt before any manual retry: ${path}`);
      return;
    }
    const receipt = (status: Receipt['status']): Receipt => ({ schemaVersion: 1, key, status, updatedAt: new Date().toISOString() });
    await writeJson(path, receipt('running'));
    try { await operation(); await writeJson(path, receipt('completed')); }
    catch (error) { await writeJson(path, receipt('failed')); throw error; }
  });
}
