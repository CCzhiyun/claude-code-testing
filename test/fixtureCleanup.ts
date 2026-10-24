import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

/** Bun/Windows does not consistently honor fs.rm maxRetries for cwd EBUSY. */
export async function removeOwnedTemporaryFixture(path: string): Promise<void> {
  const target = resolve(path);
  if (!target.startsWith(resolve(tmpdir()) + sep)) throw new Error(`Refusing fixture cleanup outside temp: ${target}`);
  for (let attempt = 0; ; attempt++) {
    try { await rm(target, { recursive: true, force: true }); return; }
    catch (error) {
      if (attempt >= 30 || !['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
  }
}
