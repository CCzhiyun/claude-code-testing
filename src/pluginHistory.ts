import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { projectStateDir } from './paths.js';
import { loadConfig } from './config.js';
import { computePluginDigest, installPlugin, loadPluginAt, verifyPluginLock } from './plugins.js';
import { verifyPluginSignature } from './pluginSignatures.js';
import { createId, readJson, withFileLock, writeJson } from './storage.js';
import { protectPath } from './policy.js';
import { abortableDelay } from './modelRetry.js';
import { executionSignal, assertExecutionActive } from './executionControl.js';

export type PluginScope = 'project' | 'local';
export interface PluginRevision { id: string; name: string; scope: PluginScope; version: string; digest: string; createdAt: string }
function identity(name: string, scope: PluginScope): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Invalid plugin name');
  if (scope !== 'project' && scope !== 'local') throw new Error('Plugin scope must be project or local');
}
export function installedPluginPath(cwd: string, name: string, scope: PluginScope = 'project'): string {
  identity(name, scope); return join(projectStateDir(cwd), scope === 'local' ? 'plugins-local' : 'plugins', name);
}
/** Reject junctions/symlinks on every existing state-path component, not just the leaf. */
export async function safePluginStatePath(cwd: string, target: string): Promise<void> {
  const root = resolve(cwd), path = resolve(target), suffix = relative(root, path);
  if (!suffix || suffix === '..' || suffix.startsWith(`..${sep}`) || resolve(root, suffix) !== path || suffix.split(sep)[0] !== '.ccpt') throw new Error('Plugin operation escapes project state');
  let current = root;
  for (const part of suffix.split(sep)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Plugin state must not traverse a symlink or junction'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') break; throw error; }
  }
}
const historyRoot = (cwd: string, name: string, scope: PluginScope): string => join(projectStateDir(cwd), 'plugin-history', scope, name);

/** Live lock is never stolen on a timeout. Interrupted locks require operator recovery. */
export async function withPluginOperation<T>(cwd: string, name: string, scope: PluginScope, action: () => Promise<T>): Promise<T> {
  identity(name, scope);
  const config = await loadConfig(cwd);
  if (config.policy.mode === 'restricted') throw new Error('Plugin mutations are disabled in restricted mode');
  const maintenance = join(projectStateDir(cwd), 'plugin-maintenance.lock');
  protectPath(maintenance, config);
  await safePluginStatePath(cwd, maintenance);
  return withFileLock(maintenance, () => lockedPluginOperation(cwd, name, scope, action));
}
async function lockedPluginOperation<T>(cwd: string, name: string, scope: PluginScope, action: () => Promise<T>): Promise<T> {
  identity(name, scope);
  const config = await loadConfig(cwd);
  const target = installedPluginPath(cwd, name, scope);
  protectPath(target, config); if (config.policy.mode === 'restricted') throw new Error('Plugin mutations are disabled in restricted mode');
  await safePluginStatePath(cwd, target);
  const lock = join(projectStateDir(cwd), 'plugin-operations', `${scope}-${process.platform === 'win32' ? name.toLowerCase() : name}.lock`);
  await safePluginStatePath(cwd, lock); await mkdir(dirname(lock), { recursive: true });
  const started = Date.now(); let handle;
  while (!handle) {
    assertExecutionActive();
    try { handle = await open(lock, 'wx', 0o600); }
    catch (error) {
      if (!['EEXIST', ...(process.platform === 'win32' ? ['EPERM', 'EACCES'] : [])].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      await safePluginStatePath(cwd, lock);
      if (Date.now() - started >= 30000) throw new Error('Plugin operation locked; inspect owner before recovering an interrupted lock');
      await abortableDelay(50, executionSignal());
    }
  }
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); return await action(); }
  finally { await handle.close(); await safePluginStatePath(cwd, lock); await rm(lock, { force: true }); }
}

export async function listPluginHistory(cwd: string, name: string, scope: PluginScope = 'project'): Promise<PluginRevision[]> {
  identity(name, scope); const root = historyRoot(cwd, name, scope); await safePluginStatePath(cwd, root);
  let entries: string[]; try { entries = await readdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const revisions: PluginRevision[] = [];
  for (const id of entries.filter(id => /^revision_[a-f0-9]{16}$/.test(id))) {
    const path = join(root, id, 'record.json'); await safePluginStatePath(cwd, path);
    const record = JSON.parse(await readFile(path, 'utf8')) as PluginRevision;
    if (record.id !== id || record.name !== name || record.scope !== scope || typeof record.version !== 'string' || !/^[a-f0-9]{64}$/.test(record.digest) || !Number.isFinite(Date.parse(record.createdAt))) throw new Error('Invalid plugin revision record');
    revisions.push(record);
  }
  return revisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
async function snapshotLocked(cwd: string, name: string, scope: PluginScope): Promise<PluginRevision> {
  const target = installedPluginPath(cwd, name, scope); await safePluginStatePath(cwd, target);
  const plugin = await loadPluginAt(target); if (plugin.name !== name) throw new Error('Installed plugin name mismatch');
  const root = historyRoot(cwd, name, scope); await safePluginStatePath(cwd, root);
  if ((await listPluginHistory(cwd, name, scope)).length >= 256) throw new Error('Plugin history limit reached (256); archive reviewed old revisions before continuing');
  const record: PluginRevision = { id: createId('revision'), name, scope, version: plugin.version, digest: await computePluginDigest(target), createdAt: new Date().toISOString() };
  await mkdir(root, { recursive: true }); const temporary = await mkdtemp(join(root, '.pending-'));
  try {
    const copied = await installPlugin(target, temporary, 'content');
    if (await computePluginDigest(copied) !== record.digest) throw new Error('Plugin changed while creating history');
    await writeJson(join(temporary, 'record.json'), record); await rename(temporary, join(root, record.id));
  } finally { await safePluginStatePath(cwd, temporary); await rm(temporary, { recursive: true, force: true }); }
  return record;
}
export async function snapshotPlugin(cwd: string, name: string, scope: PluginScope = 'project'): Promise<PluginRevision> {
  return withPluginOperation(cwd, name, scope, () => snapshotLocked(cwd, name, scope));
}
async function replaceLocked(cwd: string, name: string, scope: PluginScope, source: string): Promise<{ path: string; version: string; previous: PluginRevision }> {
  const target = installedPluginPath(cwd, name, scope), config = await loadConfig(cwd);
  protectPath(target, config); if (config.policy.mode === 'restricted') throw new Error('Plugin mutations are disabled in restricted mode');
  const approved = await loadPluginAt(source); if (approved.name !== name) throw new Error('Replacement plugin name mismatch');
  await verifyPluginLock(approved, config); await verifyPluginSignature(approved, config);
  const transactions = join(projectStateDir(cwd), 'plugin-transactions'); await safePluginStatePath(cwd, transactions); await mkdir(transactions, { recursive: true });
  const temporary = await mkdtemp(join(transactions, 'replace-')), backup = join(temporary, 'backup'); let preserve = false;
  try {
    const prepared = await installPlugin(source, temporary, 'replacement'), verified = await loadPluginAt(prepared);
    await verifyPluginLock(verified, config); await verifyPluginSignature(verified, config);
    const previous = await snapshotLocked(cwd, name, scope);
    const journal = { schemaVersion: 1, name, scope, oldDigest: previous.digest, newDigest: await computePluginDigest(prepared) };
    await writeJson(join(temporary, 'journal.json'), journal);
    assertExecutionActive(); await safePluginStatePath(cwd, target); await rename(target, backup);
    try { await rename(prepared, target); }
    catch (error) {
      try { await rename(backup, target); } catch { preserve = true; throw new Error(`Plugin replacement recovery required; preserved backup at ${backup}`); }
      throw error;
    }
    return { path: target, version: verified.version, previous };
  } finally { if (!preserve) { await safePluginStatePath(cwd, temporary); await rm(temporary, { recursive: true, force: true }); } }
}

export interface InterruptedPluginTransaction { id: string; name: string; scope: PluginScope; kind?: 'replace' | 'install'; oldDigest: string | null; newDigest: string }
export async function listInterruptedPluginTransactions(cwd: string): Promise<InterruptedPluginTransaction[]> {
  const root = join(projectStateDir(cwd), 'plugin-transactions'); await safePluginStatePath(cwd, root);
  let names: string[]; try { names = await readdir(root); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const result: InterruptedPluginTransaction[] = [];
  for (const id of names.filter(name => /^(?:replace|install)-[A-Za-z0-9_-]{1,80}$/.test(name))) {
    const path = join(root, id, 'journal.json'); await safePluginStatePath(cwd, path);
    const entry = await readJson<{ schemaVersion: number; name: string; scope: PluginScope; kind?: 'replace' | 'install'; oldDigest: string | null; newDigest: string } | null>(path, null);
    if (!entry) continue;
    identity(entry.name, entry.scope);
    const installing = entry.kind === 'install';
    if (entry.schemaVersion !== 1 || entry.kind !== undefined && !['replace', 'install'].includes(entry.kind) || installing !== id.startsWith('install-') || (installing ? entry.oldDigest !== null : typeof entry.oldDigest !== 'string' || !/^[a-f0-9]{64}$/.test(entry.oldDigest)) || !/^[a-f0-9]{64}$/.test(entry.newDigest)) throw new Error('Invalid plugin transaction journal');
    const receipt = join(root, id, 'recovered.json'); await safePluginStatePath(cwd, receipt);
    if ((await readJson<{ digest?: string } | null>(receipt, null))?.digest === (installing ? entry.newDigest : entry.oldDigest)) continue;
    result.push({ id, name: entry.name, scope: entry.scope, ...(entry.kind ? { kind: entry.kind } : {}), oldDigest: entry.oldDigest, newDigest: entry.newDigest });
  }
  return result;
}
/** Explicit operator recovery. Never overwrite an installed plugin or ignore trust policy. */
export async function recoverPluginTransaction(cwd: string, transactionId: string, confirm: boolean): Promise<{ restored: boolean; path: string }> {
  if (!confirm) throw new Error('Plugin transaction recovery requires explicit confirmation');
  const policy = await loadConfig(cwd);
  if (policy.policy.mode === 'restricted') throw new Error('Plugin mutations are disabled in restricted mode');
  const entry = (await listInterruptedPluginTransactions(cwd)).find(item => item.id === transactionId);
  if (!entry) throw new Error('Plugin transaction not found');
  const lock = join(projectStateDir(cwd), 'plugin-operations', `${entry.scope}-${process.platform === 'win32' ? entry.name.toLowerCase() : entry.name}.lock`);
  await safePluginStatePath(cwd, lock);
  await safePluginStatePath(cwd, `${lock}.recovery`);
  // An interrupted legacy operation can leave its lock. Only an explicitly
  // confirmed recovery may remove it, and only after a conclusive dead PID probe.
  await withFileLock(`${lock}.recovery`, async () => {
    const owner = await readJson<{ pid: number } | null>(lock, null);
    if (!owner) return;
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('Unknown plugin lock owner; inspect manually');
    try { process.kill(owner.pid, 0); throw new Error('Plugin operation owner is still alive'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    await rm(lock);
  });
  return withPluginOperation(cwd, entry.name, entry.scope, async () => {
    const target = installedPluginPath(cwd, entry.name, entry.scope);
    const backup = join(projectStateDir(cwd), 'plugin-transactions', entry.id, entry.kind === 'install' ? entry.name : 'backup');
    const expectedDigest = entry.kind === 'install' ? entry.newDigest : entry.oldDigest;
    await safePluginStatePath(cwd, backup); await safePluginStatePath(cwd, target);
    try { await lstat(target); throw new Error('Installed plugin already exists; recovery will not overwrite it'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const config = await loadConfig(cwd), plugin = await loadPluginAt(backup);
    if (plugin.name !== entry.name || await computePluginDigest(backup) !== expectedDigest) throw new Error('Plugin recovery backup digest does not match journal');
    await verifyPluginLock(plugin, config); await verifyPluginSignature(plugin, config);
    await mkdir(dirname(target), { recursive: true }); assertExecutionActive(); await rename(backup, target);
    await writeJson(join(projectStateDir(cwd), 'plugin-transactions', entry.id, 'recovered.json'), { restoredAt: new Date().toISOString(), digest: expectedDigest });
    return { restored: true, path: target };
  });
}
export async function replaceInstalledPlugin(cwd: string, name: string, scope: PluginScope, source: string) {
  return withPluginOperation(cwd, name, scope, () => replaceLocked(cwd, name, scope, source));
}
export async function installTrustedPlugin(cwd: string, source: string, scope: PluginScope = 'project'): Promise<string> {
  const plugin = await loadPluginAt(source);
  return withPluginOperation(cwd, plugin.name, scope, async () => {
    const config = await loadConfig(cwd);
    await verifyPluginLock(plugin, config); await verifyPluginSignature(plugin, config);
    const target = installedPluginPath(cwd, plugin.name, scope);
    const transactions = join(projectStateDir(cwd), 'plugin-transactions'); await safePluginStatePath(cwd, transactions); await mkdir(transactions, { recursive: true });
    const temporary = await mkdtemp(join(transactions, 'install-'));
    try {
      const prepared = await installPlugin(source, temporary, plugin.name), verified = await loadPluginAt(prepared);
      await verifyPluginLock(verified, config); await verifyPluginSignature(verified, config);
      await writeJson(join(temporary, 'journal.json'), { schemaVersion: 1, kind: 'install', name: plugin.name, scope, oldDigest: null, newDigest: await computePluginDigest(prepared) });
      await safePluginStatePath(cwd, target);
      try { await lstat(target); throw new Error('Plugin destination already exists'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await mkdir(dirname(target), { recursive: true }); assertExecutionActive(); await rename(prepared, target); return target;
    } finally { await safePluginStatePath(cwd, temporary); await rm(temporary, { recursive: true, force: true }); }
  });
}
export async function removeInstalledPlugin(cwd: string, name: string, scope: PluginScope): Promise<PluginRevision> {
  return withPluginOperation(cwd, name, scope, async () => {
    const revision = await snapshotLocked(cwd, name, scope), target = installedPluginPath(cwd, name, scope);
    await safePluginStatePath(cwd, target); assertExecutionActive(); await rm(target, { recursive: true, force: false }); return revision;
  });
}
export async function rollbackPlugin(cwd: string, name: string, revision: string, scope: PluginScope = 'project') {
  identity(name, scope); if (!/^revision_[a-f0-9]{16}$/.test(revision)) throw new Error('Invalid plugin revision ID');
  return withPluginOperation(cwd, name, scope, async () => {
    const record = (await listPluginHistory(cwd, name, scope)).find(item => item.id === revision); if (!record) throw new Error('Plugin revision not found');
    const source = join(historyRoot(cwd, name, scope), revision, 'content'); await safePluginStatePath(cwd, source);
    const plugin = await loadPluginAt(source);
    if (plugin.name !== name || plugin.version !== record.version || await computePluginDigest(source) !== record.digest) throw new Error('Plugin history content does not match its recorded digest');
    return { ...(await replaceLocked(cwd, name, scope, source)), restoredRevision: revision };
  });
}
