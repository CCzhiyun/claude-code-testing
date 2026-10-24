import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, readdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { projectStateDir } from './paths.js';
import { safePluginStatePath } from './pluginHistory.js';
import { createId, withFileLock, writeJson } from './storage.js';
import { loadConfig } from './config.js';
import { protectPath } from './policy.js';
import { assertExecutionActive } from './executionControl.js';
import { audit } from './audit.js';
const validId = (id: string) => /^(?:install|replace)-[A-Za-z0-9_-]{1,80}$/.test(id);

/** Raw-byte digest, not the normalized plugin digest: partial manifests need
 * not parse. No executable or contribution is ever loaded from orphan staging. */
async function orphanDigest(root: string): Promise<string> {
  const hash = createHash('sha256'); let entries = 0, totalBytes = 0;
  async function visit(path: string, relative: string, depth: number): Promise<void> {
    assertExecutionActive();
    if (++entries > 2048 || depth > 8) throw new Error('Orphan staging tree exceeds inspection bounds');
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isFile() && !info.isDirectory()) throw new Error('Orphan staging contains unsupported links/file types');
    hash.update(JSON.stringify([relative, info.isDirectory() ? 'directory' : 'file', info.size])).update('\0');
    if (info.isDirectory()) {
      const names = await readdir(path); if (names.length > 2048 - entries) throw new Error('Orphan staging entry limit');
      for (const name of names.sort()) await visit(join(path, name), relative ? relative + '/' + name : name, depth + 1);
    } else {
      if (info.size > 4 * 1024 * 1024) throw new Error('Orphan staging file exceeds 4 MiB');
      for await (const chunk of createReadStream(path)) { assertExecutionActive(); totalBytes += chunk.length; if (totalBytes > 32 * 1024 * 1024) throw new Error('Orphan staging exceeds 32 MiB'); hash.update(chunk); }
      hash.update('\0');
    }
  }
  await visit(root, '', 0); return hash.digest('hex');
}
async function noJournal(path: string) {
  try { await lstat(join(path, 'journal.json')); throw new Error('Journal exists; use transaction recovery instead of orphan quarantine'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export async function listPluginOrphans(cwd: string) {
  const root = join(projectStateDir(cwd), 'plugin-transactions'); await safePluginStatePath(cwd, root);
  let names: string[]; try { names = await readdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  if (names.length > 256) throw new Error('Transaction inspection limit (256) reached; inspect manually');
  const result: Array<{ id: string; digest?: string; inspectable: boolean; action: string }> = [];
  for (const id of names.filter(validId).sort()) {
    const path = join(root, id); await safePluginStatePath(cwd, path);
    try { await noJournal(path); } catch (error) { if (String(error).includes('Journal exists')) continue; throw error; }
    try { result.push({ id, digest: await orphanDigest(path), inspectable: true, action: 'Review owner and bytes; explicit quarantine only. Never installed or executed.' }); }
    catch { result.push({ id, inspectable: false, action: 'Unsupported/oversized/changing staging; retain and inspect manually. Not installed.' }); }
  }
  return result;
}

/** Reversible containment, not guessed recovery. Global maintenance gate plus
 * legacy-lock refusal prevents moving an in-progress install from this CLI. */
export async function quarantinePluginOrphan(cwd: string, id: string, expectedDigest: string, confirmed: boolean) {
  if (!confirmed || !validId(id) || !/^[a-f0-9]{64}$/.test(expectedDigest)) throw new Error('Orphan quarantine requires an exact ID, --expected-digest and --confirm');
  const config = await loadConfig(cwd);
  if (config.policy.mode === 'restricted') throw new Error('Plugin mutations are disabled in restricted mode');
  const source = join(projectStateDir(cwd), 'plugin-transactions', id); protectPath(source, config);
  const maintenance = join(projectStateDir(cwd), 'plugin-maintenance.lock'); await safePluginStatePath(cwd, maintenance);
  return withFileLock(maintenance, async () => {
    const operations = join(projectStateDir(cwd), 'plugin-operations'); await safePluginStatePath(cwd, operations);
    let locks: string[] = [];
    try { locks = await readdir(operations); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (locks.some(name => name.endsWith('.lock'))) throw new Error('Plugin operation lock exists; inspect/recover its owner before quarantining unattributed staging');
    await safePluginStatePath(cwd, source); await noJournal(source);
    if (await orphanDigest(source) !== expectedDigest) throw new Error('Orphan staging changed; inspect it again');
    const target = join(projectStateDir(cwd), 'plugin-quarantine', createId('quarantine'));
    protectPath(target, config); await safePluginStatePath(cwd, target); await mkdir(target, { recursive: true });
    await writeJson(join(target, 'receipt.json'), { format: 1, originalId: id, digest: expectedDigest, movedAt: new Date().toISOString(), installed: false });
    await audit({ event: 'plugin.orphan.quarantine', outcome: 'requested', details: { id, digest: expectedDigest } });
    assertExecutionActive(); await rename(source, join(target, 'staging'));
    await audit({ event: 'plugin.orphan.quarantine', outcome: 'success', details: { id, digest: expectedDigest } });
    return { directory: target, recoverable: true, installed: false, executed: false };
  });
}
