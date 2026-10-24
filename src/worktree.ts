import { copyFile, lstat, mkdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { PlatformConfig } from './types.js';
import { executeCommand } from './policy.js';
import { runHooks } from './hooks.js';
import { createId } from './storage.js';
import { audit } from './audit.js';
import { createHash } from 'node:crypto';
import { readUtf8Text } from './textFiles.js';
import { withFileLock } from './storage.js';
import { projectStateDir } from './paths.js';
import { protectPath } from './policy.js';
import { assertWithinRoots } from './paths.js';

function validateAgentId(agentId: string): void {
  if (!/^agent_[a-f0-9]{16}$/.test(agentId)) throw new Error(`Invalid Agent id for worktree operation: ${agentId}`);
}

function worktreeConfig(repo: string, target: string, config: PlatformConfig): PlatformConfig {
  const root = resolve(repo);
  const allowedParent = resolve(dirname(root), '.ccpt-worktrees', basename(root));
  const absoluteTarget = resolve(target);
  if (absoluteTarget !== allowedParent && !absoluteTarget.startsWith(`${allowedParent}\\`) && !absoluteTarget.startsWith(`${allowedParent}/`)) {
    throw new Error(`Worktree target is outside the managed worktree directory: ${absoluteTarget}`);
  }
  const scoped = structuredClone(config);
  if (!scoped.policy.workspaceRoots.includes(absoluteTarget)) scoped.policy.workspaceRoots.push(absoluteTarget);
  return scoped;
}

export async function includeWorktreeFiles(repo: string, target: string, files: readonly string[], config: PlatformConfig): Promise<string[]> {
  const root = resolve(repo);
  worktreeConfig(root, target, config);
  const copied: string[] = [];
  for (const file of [...new Set(files)]) {
    if (!file.trim() || isAbsolute(file)) throw new Error(`Additional worktree file must be relative: ${file}`);
    const source = resolve(root, file);
    const destination = resolve(target, file);
    protectPath(assertWithinRoots(source, [root]), config);
    protectPath(assertWithinRoots(destination, [target]), worktreeConfig(root, target, config));
    const sourceRelative = relative(root, source);
    const destinationRelative = relative(target, destination);
    if (sourceRelative.startsWith('..') || isAbsolute(sourceRelative) || destinationRelative.startsWith('..') || isAbsolute(destinationRelative)) throw new Error(`Additional worktree file escapes its root: ${file}`);
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Additional worktree path must be a regular file: ${file}`);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
    copied.push(destinationRelative.split('\\').join('/'));
  }
  return copied;
}

export async function createWorktree(repo: string, agentId: string, config: PlatformConfig, additionalFiles: readonly string[] = []): Promise<string> {
  validateAgentId(agentId);
  const root = resolve(repo);
  const parent = join(dirname(root), '.ccpt-worktrees', basename(root));
  const target = join(parent, agentId);
  await mkdir(parent, { recursive: true });
  const branch = `agentic/${agentId}`;
  const result = await executeCommand('git', ['worktree', 'add', '-b', branch, target, 'HEAD'], root, config, agentId);
  if (result.code !== 0) throw new Error(`git worktree add failed: ${result.stderr.trim()}`);
  if (!config.policy.workspaceRoots.includes(target)) config.policy.workspaceRoots.push(target);
  const includedFiles = additionalFiles.length ? await includeWorktreeFiles(root, target, additionalFiles, config) : [];
  await runHooks(config, 'WorktreeCreate', { agentId, repo: root, worktree: target, branch, includedFiles }, target);
  return target;
}

export async function removeWorktree(repo: string, target: string, config: PlatformConfig): Promise<void> {
  const root = resolve(repo);
  const scoped = worktreeConfig(root, target, config);
  const agentId = basename(resolve(target));
  validateAgentId(agentId);
  // A matching directory name is not proof that it belongs to this repository.
  const rootCommon = await executeCommand('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], root, scoped, agentId);
  const targetCommon = await executeCommand('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], target, scoped, agentId);
  const normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  if (rootCommon.code !== 0 || targetCommon.code !== 0 || normalize(rootCommon.stdout.trim()) !== normalize(targetCommon.stdout.trim())) throw new Error('Worktree does not belong to the specified repository');
  await runHooks(scoped, 'WorktreeRemove', { repo: root, worktree: target }, target);
  const ignored = await executeCommand('git', ['ls-files', '--others', '--ignored', '--exclude-standard'], target, scoped, agentId);
  if (ignored.code !== 0) throw new Error(`Unable to inspect ignored worktree files: ${ignored.stderr.trim()}`);
  if (ignored.stdout.trim()) throw new Error('Worktree contains ignored files that a Git checkpoint cannot preserve. Cleanup refused; inspect and retain them before retrying.');
  const status = await executeCommand('git', ['status', '--porcelain'], target, scoped, agentId);
  if (status.code !== 0) throw new Error(`Unable to inspect worktree before cleanup: ${status.stderr.trim()}`);
  if (status.stdout.trim()) {
    const added = await executeCommand('git', ['add', '-A'], target, scoped, agentId);
    if (added.code !== 0) throw new Error(`Unable to preserve worktree changes: ${added.stderr.trim()}`);
    const committed = await executeCommand('git', ['commit', '-m', `CCPT: preserve ${agentId} before cleanup`], target, scoped, agentId);
    if (committed.code !== 0) throw new Error(`Unable to checkpoint worktree changes: ${committed.stderr.trim()}`);
  }
  const head = await executeCommand('git', ['rev-parse', '--verify', 'HEAD'], target, scoped, agentId);
  const oid = head.stdout.trim();
  if (head.code !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)) throw new Error('Unable to resolve a safe commit before worktree cleanup');
  // Preserve detached/unpublished commits independently of mutable branch names.
  // This never pushes, deletes a branch, or treats local refs as proof of a push.
  const ref = `refs/ccpt/recovery/${agentId}/${createId('save')}`;
  const retained = await executeCommand('git', ['update-ref', '-m', `CCPT retain ${agentId} before cleanup`, ref, oid, '0'.repeat(oid.length)], root, scoped, agentId);
  if (retained.code !== 0) throw new Error(`Unable to retain worktree commit; cleanup refused: ${retained.stderr.trim()}`);
  await (await import('./recoveryMaintenance.js')).recordRecoveryAge(root,ref,oid);
  await audit({ event: 'worktree.retained', actor: agentId, outcome: 'success', details: { repo: root, worktree: target, ref, oid } });
  const result = await executeCommand('git', ['worktree', 'remove', target], root, scoped);
  if (result.code !== 0) throw new Error(`git worktree remove failed: ${result.stderr.trim()}`);
  if(config.recoveryMaintenance?.enabled&&config.recoveryMaintenance.automatic){const maintenance=await import('./recoveryMaintenance.js');const plan=await maintenance.planRecoveryMaintenance(root,config);await maintenance.runRecoveryMaintenance(root,plan.digest,true,config);}
}

export async function listWorktreeRecoveries(repo: string, config: PlatformConfig): Promise<Array<{ ref: string; commit: string }>> {
  const root = protectPath(resolve(repo), config);
  const result = await executeCommand('git', ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/ccpt/recovery/'], root, config);
  if (result.code !== 0) throw new Error(`Unable to list worktree recovery refs: ${result.stderr.trim()}`);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).map(line => {
    const [ref = '', commit = ''] = line.split(' ');
    if (!/^refs\/ccpt\/recovery\/agent_[a-f0-9]{16}\/save_[a-f0-9]{16}$/.test(ref) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid worktree recovery ref');
    return { ref, commit };
  });
}

/** Creates a new local branch only; never overwrites/checks out/pushes anything. */
export async function restoreWorktreeRecovery(repo: string, ref: string, branch: string, config: PlatformConfig): Promise<{ branch: string; commit: string }> {
  if (!/^refs\/ccpt\/recovery\/agent_[a-f0-9]{16}\/save_[a-f0-9]{16}$/.test(ref)) throw new Error('Select an exact managed recovery ref');
  if (!branch || branch.startsWith('-') || branch.length > 200) throw new Error('Invalid recovery branch name');
  const root = protectPath(resolve(repo), config);
  const checked = await executeCommand('git', ['check-ref-format', '--branch', branch], root, config);
  if (checked.code !== 0) throw new Error('Invalid recovery branch name');
  const saved = (await listWorktreeRecoveries(root, config)).find(item => item.ref === ref);
  if (!saved) throw new Error('Recovery ref not found');
  const created = await executeCommand('git', ['branch', branch, saved.commit], root, config);
  if (created.code !== 0) throw new Error(`Recovery branch was not created: ${created.stderr.trim()}`);
  return { branch, commit: saved.commit };
}

export async function inspectGitConflicts(repo: string, config: PlatformConfig): Promise<Array<{ path: string; stages: number[] }>> {
  const root = protectPath(resolve(repo), config);
  const result = await executeCommand('git', ['ls-files', '--unmerged', '-z'], root, config);
  if (result.code !== 0) throw new Error(`Unable to inspect Git conflicts: ${result.stderr.trim()}`);
  const files = new Map<string, number[]>();
  for (const entry of result.stdout.split('\0').filter(Boolean)) {
    const match = /^\d+ [a-f0-9]+ ([123])\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error('Invalid Git conflict record');
    const path = match[2]!; protectPath(resolve(root, path), config);
    files.set(path, [...(files.get(path) ?? []), Number(match[1])]);
  }
  return [...files].map(([path, stages]) => ({ path, stages }));
}

export async function recoveryPage(repo: string, config: PlatformConfig, offset = 0, limit = 50): Promise<{ items: Array<{ ref: string; commit: string }>; total: number; nextOffset: number | null }> {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Recovery pagination requires offset >=0 and limit 1–200');
  const all = (await listWorktreeRecoveries(repo, config)).sort((a, b) => a.ref.localeCompare(b.ref));
  return { items: all.slice(offset, offset + limit), total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null };
}
/** Delete one exact reviewed ref only when a branch/tag still retains its commit. No age-based deletion. */
export async function pruneWorktreeRecovery(repo: string, ref: string, expectedCommit: string, confirmed: boolean, config: PlatformConfig): Promise<void> {
  if (!confirmed) throw new Error('Recovery pruning requires --confirm and an expected commit');
  const root = protectPath(resolve(repo), config);
  const saved = (await listWorktreeRecoveries(root, config)).find(item => item.ref === ref);
  if (!saved || saved.commit !== expectedCommit) throw new Error('Recovery ref changed or missing; refresh before pruning');
  const retained = await executeCommand('git', ['for-each-ref', `--contains=${saved.commit}`, '--format=%(refname)', 'refs/heads/', 'refs/tags/'], root, config);
  if (retained.code !== 0 || !retained.stdout.trim()) throw new Error('Retain this commit in a branch/tag before removing its recovery ref');
  await audit({ event: 'worktree.recovery.prune', outcome: 'requested', details: { ref, commit: saved.commit } });
  const removed = await executeCommand('git', ['update-ref', '-d', ref, saved.commit], root, config);
  if (removed.code !== 0) throw new Error('Recovery ref changed or could not be removed');
  await audit({ event: 'worktree.recovery.prune', outcome: 'success', details: { ref, commit: saved.commit } });
}

export async function conflictGuide(repo: string, file: string, config: PlatformConfig): Promise<{ path: string; version: string; stages: number[]; markersRemain: boolean; instructions: string[] }> {
  const root = protectPath(resolve(repo), config), path = protectPath(resolve(root, file), config);
  assertWithinRoots(path, [root]);
  const relativePath = relative(root, path).split('\\').join('/');
  const conflict = (await inspectGitConflicts(root, config)).find(item => item.path === relativePath);
  if (!conflict) throw new Error('Select an exact conflicted file from agents conflicts');
  const index = await executeCommand('git', ['ls-files', '--unmerged', '-z', '--', relativePath], root, config);
  if (index.code !== 0) throw new Error('Unable to inspect conflict index');
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Conflict guide supports existing regular UTF-8 files only; inspect binary/deletion conflicts manually');
  const text = await readUtf8Text(path, 2_000_000);
  return { path: relativePath, version: createHash('sha256').update(index.stdout).update(text).digest('hex'), stages: conflict.stages, markersRemain: /^(?:<{7}|={7}|>{7})(?: |$)/m.test(text), instructions: ['Review base/ours/theirs with your editor; this guide never chooses or overwrites content.', 'Edit and save the resolved file, then refresh this guide to obtain its new version.', 'Stage only with conflict-stage <path> --expected-version <version> --confirm. No commit/push/PR is performed.'] };
}

/** Metadata-only base/ours/theirs view also works for binary and delete/modify
 * conflicts. Never decode a blob as text or choose a destructive resolution. */
export async function conflictVersions(repo: string, file: string, config: PlatformConfig) {
  const root = protectPath(resolve(repo), config), path = protectPath(resolve(root, file), config);
  assertWithinRoots(path, [root]);
  const relativePath = relative(root, path).split('\\').join('/');
  const conflict = (await inspectGitConflicts(root, config)).find(item => item.path === relativePath);
  if (!conflict) throw new Error('Select an exact conflicted file from agents conflicts');
  const index = await executeCommand('git', ['ls-files', '--unmerged', '-z', '--', relativePath], root, config);
  if (index.code !== 0) throw new Error('Unable to inspect conflict index');
  const versions: Array<{ side: string; present: boolean; mode?: string; objectId?: string; bytes?: number }> = [];
  for (const [stage, side] of [[1, 'base'], [2, 'ours'], [3, 'theirs']] as const) {
    const row = index.stdout.split('\0').map(value => /^(\d{6}) ([a-f0-9]{40,64}) ([123])\t([\s\S]*)$/.exec(value)).find(value => value && Number(value[3]) === stage && value[4] === relativePath);
    if (!row) { versions.push({ side, present: false }); continue; }
    const size = await executeCommand('git', ['cat-file', '-s', row[2]!], root, config);
    if (size.code !== 0 || !/^\d+\s*$/.test(size.stdout)) throw new Error('Unable to inspect conflict blob size');
    versions.push({ side, present: true, mode: row[1]!, objectId: row[2]!, bytes: Number(size.stdout) });
  }
  let working: { present: boolean; regular?: boolean; bytes?: number };
  try { const info = await lstat(path); working = { present: true, regular: info.isFile() && !info.isSymbolicLink(), bytes: info.size }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; working = { present: false }; }
  return { path: relativePath, indexVersion: createHash('sha256').update(index.stdout).digest('hex'), versions, working,
    kind: !versions[1]!.present || !versions[2]!.present ? 'delete/modify' : !versions[0]!.present ? 'add/add' : 'both modified (text or binary)',
    readOnly: true, instructions: ['Absent side means that side deleted/does not contain the path; do not treat it as an empty blob.', 'Object IDs, modes and byte sizes are shown instead of unsafe binary decoding.', 'Review binary/deletion resolutions in your editor or Git client. This command never writes, stages, commits or pushes.'] };
}
export async function stageResolvedConflict(repo: string, file: string, expectedVersion: string, confirmed: boolean, config: PlatformConfig): Promise<void> {
  if (!confirmed || !/^[a-f0-9]{64}$/.test(expectedVersion)) throw new Error('Conflict staging requires --confirm and a reviewed --expected-version');
  await withFileLock(join(projectStateDir(repo), 'git-conflict-resolution.lock'), async () => {
    const guide = await conflictGuide(repo, file, config);
    if (guide.version !== expectedVersion) throw new Error('Conflict contents/index changed; refresh and review again');
    if (guide.markersRemain) throw new Error('Conflict markers remain; edit the file before staging');
    await audit({ event: 'git.conflict.stage', outcome: 'requested', details: { path: guide.path, version: guide.version } });
    const result = await executeCommand('git', ['add', '--', guide.path], resolve(repo), config);
    if (result.code !== 0) throw new Error('Unable to stage the reviewed resolution');
    await audit({ event: 'git.conflict.stage', outcome: 'success', details: { path: guide.path, version: guide.version } });
  });
}

/** Human resolves bytes/deletion in their editor, then reviews this bounded CAS
 * receipt. Binary data is hashed, never decoded into terminal control sequences. */
export async function reviewBinaryConflict(repo:string,file:string,config:PlatformConfig){
 const root=protectPath(resolve(repo),config),path=protectPath(resolve(root,file),config);assertWithinRoots(path,[root]);
 let current=root;for(const name of relative(root,path).split(/[\\/]/).filter(Boolean)){current=join(current,name);try{if((await lstat(current)).isSymbolicLink())throw new Error('Conflict resolution must not traverse links');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
 const metadata=await conflictVersions(root,file,config);let working:{present:boolean;sha256?:string;bytes?:number;binary?:boolean;markersRemain?:boolean};
 try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16*1024*1024)throw new Error('Reviewed conflict file must be a non-link regular file up to 16 MiB');const bytes=await readFile(path);if(bytes.length>16*1024*1024)throw new Error('Conflict file grew beyond bounds');let text:string|undefined;try{if(!bytes.includes(0))text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{}working={present:true,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,binary:text===undefined,markersRemain:text!==undefined&&/^(?:<{7}|={7}|>{7})(?: |$)/m.test(text)};}
 catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;working={present:false};}
 const version=createHash('sha256').update(JSON.stringify([metadata.path,metadata.indexVersion,working])).digest('hex');return {path:metadata.path,version,indexVersion:metadata.indexVersion,versions:metadata.versions,working,readOnly:true,action:working.present?'stage-reviewed-file':'stage-reviewed-deletion'};
}
export async function stageReviewedBinaryConflict(repo:string,file:string,expectedVersion:string,confirmed:boolean,config:PlatformConfig){
 if(!confirmed||!/^[a-f0-9]{64}$/.test(expectedVersion))throw new Error('Binary/deletion staging requires --confirm and a reviewed version');
 return withFileLock(join(projectStateDir(repo),'git-conflict-resolution.lock'),async()=>{
  const reviewed=await reviewBinaryConflict(repo,file,config);if(reviewed.version!==expectedVersion)throw new Error('Conflict index/working bytes changed; review again');if(reviewed.working.markersRemain)throw new Error('Conflict markers remain');
  await audit({event:'git.conflict.binary-stage',outcome:'requested',details:{path:reviewed.path,version:reviewed.version,present:reviewed.working.present}});
  const result=await executeCommand('git',['add','-A','--',reviewed.path],resolve(repo),config);if(result.code!==0)throw new Error('Unable to stage reviewed bytes/deletion; inspect index before retry');
  return {path:reviewed.path,staged:true,deleted:!reviewed.working.present,committed:false,pushed:false};
 });
}

export async function mergeWorktree(repo: string, target: string, agentId: string, config: PlatformConfig): Promise<void> {
  validateAgentId(agentId);
  const root = resolve(repo);
  const scoped = worktreeConfig(root, target, config);
  const baseStatus = await executeCommand('git', ['status', '--porcelain'], root, scoped, agentId);
  if (baseStatus.code !== 0 || baseStatus.stdout.trim()) throw new Error('The integration worktree must be clean before merging Agent work');
  const worktreeStatus = await executeCommand('git', ['status', '--porcelain'], target, scoped, agentId);
  if (worktreeStatus.code !== 0) throw new Error(worktreeStatus.stderr || 'Unable to inspect Agent worktree');
  if (worktreeStatus.stdout.trim()) {
    const added = await executeCommand('git', ['add', '-A'], target, scoped, agentId);
    if (added.code !== 0) throw new Error(added.stderr || 'Unable to stage Agent changes');
    const committed = await executeCommand('git', ['commit', '-m', `CCPT: integrate ${agentId}`], target, scoped, agentId);
    if (committed.code !== 0) throw new Error(committed.stderr || 'Unable to commit Agent changes');
  }
  const branch = `agentic/${agentId}`;
  const merged = await executeCommand('git', ['merge', '--no-edit', branch], root, scoped, agentId);
  if (merged.code !== 0) throw new Error(`Git merge requires human conflict resolution: ${merged.stderr.trim()}`);
  await removeWorktree(root, target, scoped);
  const deleted = await executeCommand('git', ['branch', '-d', branch], root, scoped, agentId);
  if (deleted.code !== 0) throw new Error(`Merged changes but could not delete branch ${branch}: ${deleted.stderr.trim()}`);
}
