import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, resolve, sep } from 'node:path';
import type { PlatformConfig } from './types.js';
import { assertWithinRoots, projectStateDir } from './paths.js';
import { protectPath, executeCommand } from './policy.js';
import { assertExecutionActive } from './executionControl.js';
import { createId, writeJson } from './storage.js';
import { listWorktreeRecoveries } from './worktree.js';
import { audit } from './audit.js';

interface BackupManifest { format: 1; id: string; createdAt: string; sha256: string; refs: Array<{ ref: string; commit: string }> }
const managedRef = /^refs\/ccpt\/recovery\/agent_[a-f0-9]{16}\/save_[a-f0-9]{16}$/;
const objectId = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

async function noLinks(root: string, path: string): Promise<void> {
  const target = resolve(path), suffix = relative(resolve(root), target);
  if (suffix === '..' || suffix.startsWith('..' + sep)) throw new Error('Backup path escapes workspace');
  let current = resolve(root);
  for (const part of suffix.split(sep).filter(Boolean)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Recovery backup must not traverse links'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}
async function fileInfo(path: string, limit: number) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error('Backup file type/size exceeds supported bounds');
  return info;
}
async function hashBundle(path: string): Promise<string> {
  await fileInfo(path, 512 * 1024 * 1024);
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path)) { assertExecutionActive(); bytes += chunk.length; if (bytes > 512 * 1024 * 1024) throw new Error('Bundle exceeds 512 MiB'); hash.update(chunk); }
  return hash.digest('hex');
}
function heads(text: string): Array<{ ref: string; commit: string }> {
  const rows = text.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length < 1 || rows.length > 128) throw new Error('Recovery bundle supports 1–128 managed refs');
  return rows.map(line => {
    const [commit, ref, ...rest] = line.split(' ');
    if (!ref || !commit || rest.length || !managedRef.test(ref) || !objectId.test(commit)) throw new Error('Unexpected recovery bundle ref');
    return { ref, commit };
  }).sort((a, b) => a.ref.localeCompare(b.ref));
}
function validateManifest(value: unknown): BackupManifest {
  const record = value as BackupManifest;
  if (!record || record.format !== 1 || !/^backup_[a-f0-9]{16}$/.test(record.id) || !Number.isFinite(Date.parse(record.createdAt)) || !/^[a-f0-9]{64}$/.test(record.sha256) || !Array.isArray(record.refs)) throw new Error('Invalid recovery backup manifest');
  const refs = heads(record.refs.map(row => `${row?.commit} ${row?.ref}`).join('\n'));
  if (new Set(refs.map(row => row.ref)).size !== refs.length) throw new Error('Duplicate recovery backup ref');
  return { format: 1, id: record.id, createdAt: record.createdAt, sha256: record.sha256, refs };
}
async function completeBundle(path: string): Promise<void> {
  const handle = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(128 * 1024), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    const end = bytes.subarray(0, bytesRead).indexOf('\n\n');
    if (end < 0) throw new Error('Bundle header exceeds bounds');
    const header = bytes.subarray(0, end).toString('utf8');
    if (!/^# v[23] git bundle\n/.test(header) || header.split('\n').some(line => line.startsWith('-'))) throw new Error('Backup must be a complete Git bundle, without external prerequisites');
  } finally { await handle.close(); }
}

/** Export committed history only. Untracked files, working edits, settings and
 * credentials are not included. A bundle may still contain historical secrets. */
export async function createRecoveryBackup(repo: string, config: PlatformConfig, confirmed: boolean) {
  if (!confirmed) throw new Error('Recovery backup export requires --confirm; committed history may contain sensitive data');
  const root = protectPath(resolve(repo), config);
  if (config.policy.mode === 'restricted') throw new Error('Recovery backup mutations are disabled in restricted mode');
  const refs = (await listWorktreeRecoveries(root, config)).sort((a, b) => a.ref.localeCompare(b.ref));
  if (!refs.length || refs.length > 128) throw new Error('Select a repository with 1–128 managed recovery refs');
  const directory = join(projectStateDir(root), 'recovery-backups');
  await noLinks(root, directory); await mkdir(directory, { recursive: true, mode: 0o700 }); await noLinks(root, directory);
  const temporary = await mkdtemp(join(directory, '.pending-')), id = createId('backup'), destination = join(directory, id);
  try {
    const path = join(temporary, 'recovery.bundle');
    await audit({ event: 'worktree.backup.export', outcome: 'requested', details: { refs: refs.length } });
    const result = await executeCommand('git', ['bundle', 'create', path, ...refs.map(row => row.ref)], root, config);
    if (result.code !== 0) throw new Error('Unable to create a complete recovery bundle');
    await chmod(path, 0o600);
    const listed = await executeCommand('git', ['bundle', 'list-heads', path], root, config);
    if (listed.code !== 0 || JSON.stringify(heads(listed.stdout)) !== JSON.stringify(refs)) throw new Error('Recovery refs changed during export; no backup was published');
    await completeBundle(path);
    const sha256 = await hashBundle(path);
    const manifest: BackupManifest = { format: 1, id, createdAt: new Date().toISOString(), sha256, refs };
    await writeJson(join(temporary, 'manifest.json'), manifest);
    await noLinks(root, destination); assertExecutionActive(); await rename(temporary, destination);
    await audit({ event: 'worktree.backup.export', outcome: 'success', details: { id, sha256, refs: refs.length } });
    return { directory: destination, sha256, refs, containsCommittedHistory: true, workingFilesIncluded: false, networkRequests: 0 };
  } finally {
    await noLinks(root, temporary);
    if (resolve(temporary).startsWith(resolve(directory) + sep + '.pending-')) await rm(temporary, { recursive: true, force: true });
  }
}

/** Digest is obtained from a separately trusted export result, not merely from
 * the accompanying editable manifest. No authenticity/signature is implied. */
export async function inspectRecoveryBackup(repo: string, directory: string, expectedSha256: string, config: PlatformConfig) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error('A trusted --expected-sha256 is required');
  const root = protectPath(resolve(repo), config), folder = protectPath(resolve(root, directory), config);
  assertWithinRoots(folder, [root]); await noLinks(root, folder);
  const path = join(folder, 'recovery.bundle'), manifestPath = join(folder, 'manifest.json');
  await noLinks(root, path); await noLinks(root, manifestPath); await fileInfo(manifestPath, 128 * 1024);
  const manifest = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  const sha256 = await hashBundle(path);
  if (sha256 !== expectedSha256 || manifest.sha256 !== expectedSha256) throw new Error('Recovery bundle digest mismatch');
  await completeBundle(path);
  const verified = await executeCommand('git', ['bundle', 'verify', path], root, config);
  if (verified.code !== 0) throw new Error('Git rejected recovery bundle integrity/object format');
  const listed = await executeCommand('git', ['bundle', 'list-heads', path], root, config);
  if (listed.code !== 0 || JSON.stringify(heads(listed.stdout)) !== JSON.stringify(manifest.refs)) throw new Error('Recovery manifest does not match bundled refs');
  return { manifest, path, sha256, readOnly: true, networkRequests: 0 };
}

/** Import objects, then create exactly one NEW local branch. Never checkout,
 * overwrite an existing branch/ref, run a merge, push or execute project code. */
export async function importRecoveryBackup(input: { repo: string; directory: string; expectedSha256: string; ref: string; branch: string; confirmed: boolean }, config: PlatformConfig) {
  if (!input.confirmed) throw new Error('Recovery import requires --confirm');
  if (!managedRef.test(input.ref) || !input.branch || input.branch.startsWith('-') || input.branch.length > 200 || input.branch === 'HEAD') throw new Error('Select a managed ref and a new local branch name');
  const root = protectPath(resolve(input.repo), config);
  const checked = await executeCommand('git', ['check-ref-format', '--branch', input.branch], root, config);
  if (checked.code !== 0) throw new Error('Invalid recovery branch name');
  const exists = await executeCommand('git', ['show-ref', '--verify', '--quiet', `refs/heads/${input.branch}`], root, config);
  if (exists.code === 0) throw new Error('Recovery branch already exists; import will not overwrite it');
  if (exists.code !== 1) throw new Error('Unable to inspect target branch');
  const backup = await inspectRecoveryBackup(root, input.directory, input.expectedSha256, config);
  const selected = backup.manifest.refs.find(row => row.ref === input.ref);
  if (!selected) throw new Error('Selected recovery ref is not in this bundle');
  await audit({ event: 'worktree.backup.import', outcome: 'requested', details: { sha256: backup.sha256, ref: selected.ref, branch: input.branch } });
  // Recheck before object ingestion. Same-user concurrent filesystem tampering
  // cannot be fully excluded without OS isolation; do not import untrusted files.
  if (await hashBundle(backup.path) !== backup.sha256) throw new Error('Recovery bundle changed before import');
  const unpacked = await executeCommand('git', ['bundle', 'unbundle', backup.path], root, config);
  if (unpacked.code !== 0 || JSON.stringify(heads(unpacked.stdout)) !== JSON.stringify(backup.manifest.refs)) throw new Error('Bundle import failed; inspect object store before retrying. No branch was intentionally changed.');
  const commit = await executeCommand('git', ['cat-file', '-t', selected.commit], root, config);
  if (commit.code !== 0 || commit.stdout.trim() !== 'commit') throw new Error('Recovery target is not a commit');
  const created = await executeCommand('git', ['update-ref', `refs/heads/${input.branch}`, selected.commit, '0'.repeat(selected.commit.length)], root, config);
  if (created.code !== 0) throw new Error('Recovery branch was not created; it may have changed concurrently. Imported objects were retained.');
  await audit({ event: 'worktree.backup.import', outcome: 'success', details: { sha256: backup.sha256, branch: input.branch, commit: selected.commit } });
  return { branch: input.branch, commit: selected.commit, checkoutChanged: false, networkRequests: 0 };
}
