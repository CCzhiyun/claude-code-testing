import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { createWorktree, includeWorktreeFiles, inspectGitConflicts, listWorktreeRecoveries, restoreWorktreeRecovery, mergeWorktree, removeWorktree } from '../src/worktree.js';

let container = '';
let repo = '';
let previousHome: string | undefined;

beforeAll(async () => {
  container = await mkdtemp(join(tmpdir(), 'ccpt-git-'));
  previousHome = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(container, 'state');
  repo = join(container, 'repository');
  execFileSync('git', ['init', repo]);
  execFileSync('git', ['config', 'user.email', 'tests@ccpt.local'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'CCPT Tests'], { cwd: repo });
  await writeFile(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: repo });
});

afterAll(async () => {
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  await rm(container, { recursive: true, force: true });
});

describe('isolated Git workflow', () => {
  test('creates, commits, merges, and removes a managed Agent worktree', async () => {
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [repo];
    const id = 'agent_1234567890abcdef';
    const target = await createWorktree(repo, id, config);
    await writeFile(join(target, 'feature.txt'), 'isolated change\n');
    await mergeWorktree(repo, target, id, config);
    expect((await readFile(join(repo, 'feature.txt'), 'utf8')).trim()).toBe('isolated change');
    expect(execFileSync('git', ['branch', '--list', `agentic/${id}`], { cwd: repo, encoding: 'utf8' }).trim()).toBe('');
  });

  test('checkpoints dirty Agent changes before automatic worktree cleanup', async () => {
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [repo];
    const id = 'agent_fedcba0987654321';
    const target = await createWorktree(repo, id, config);
    await writeFile(join(target, 'checkpoint.txt'), 'preserved change\n');
    await removeWorktree(repo, target, config);
    expect(execFileSync('git', ['show', `agentic/${id}:checkpoint.txt`], { cwd: repo, encoding: 'utf8' }).trim()).toBe('preserved change');
    expect(execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repo, encoding: 'utf8' })).not.toContain(target);
    expect((await listWorktreeRecoveries(repo, config)).some(item => item.ref.includes(id))).toBe(true);
  });

  test('retains detached unpublished commits independently of deleted branches', async () => {
    const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [repo];
    const id = 'agent_2222222222222222'; const target = await createWorktree(repo, id, config);
    await writeFile(join(target, 'detached.txt'), 'Unpublished detached evidence');
    execFileSync('git', ['add', 'detached.txt'], { cwd: target }); execFileSync('git', ['commit', '-m', 'detached fixture'], { cwd: target });
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: target, encoding: 'utf8' }).trim();
    execFileSync('git', ['checkout', '--detach'], { cwd: target }); execFileSync('git', ['branch', '-D', `agentic/${id}`], { cwd: repo });
    await removeWorktree(repo, target, config);
    const saved = (await listWorktreeRecoveries(repo, config)).find(item => item.commit === head);
    expect(saved).toBeDefined();
    execFileSync('git', ['gc', '--prune=now'], { cwd: repo });
    expect(execFileSync('git', ['show', `${saved!.ref}:detached.txt`], { cwd: repo, encoding: 'utf8' })).toBe('Unpublished detached evidence');
  });

  test('refuses cleanup rather than lose ignored files', async () => {
    const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [repo];
    const target = await createWorktree(repo, 'agent_3333333333333333', config);
    await writeFile(join(target, '.gitignore'), 'valuable.local\n'); await writeFile(join(target, 'valuable.local'), 'retain local evidence');
    await expect(removeWorktree(repo, target, config)).rejects.toThrow('ignored files');
    await access(target); expect(await readFile(join(target, 'valuable.local'), 'utf8')).toBe('retain local evidence');
  });

  test('rejects an unrelated repository even in a managed-looking directory', async () => {
    const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [repo];
    const target = join(container, '.ccpt-worktrees', 'repository', 'agent_4444444444444444');
    await mkdir(target, { recursive: true }); execFileSync('git', ['init'], { cwd: target });
    await expect(removeWorktree(repo, target, config)).rejects.toThrow('does not belong'); await access(target);
  });

  test('included worktree files cannot traverse intermediate source or destination symlinks', async () => {
    const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [repo];
    const target = await createWorktree(repo, 'agent_5555555555555555', config);
    const outside = join(container, 'outside'); await mkdir(outside); await writeFile(join(outside, 'evidence.txt'), 'not in repository');
    await symlink(outside, join(repo, 'source-junction'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(includeWorktreeFiles(repo, target, ['source-junction/evidence.txt'], config)).rejects.toThrow('outside');
    await mkdir(join(repo, 'destination-junction')); await writeFile(join(repo, 'destination-junction', 'evidence.txt'), 'allowed input');
    await symlink(outside, join(target, 'destination-junction'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(includeWorktreeFiles(repo, target, ['destination-junction/evidence.txt'], config)).rejects.toThrow('outside');
    expect(await readFile(join(outside, 'evidence.txt'), 'utf8')).toBe('not in repository');
  });

  test('recovery creates a new local branch without checkout or overwriting an existing branch', async () => {
    const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [repo];
    const saved = (await listWorktreeRecoveries(repo, config))[0]!;
    const before = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
    const result = await restoreWorktreeRecovery(repo, saved.ref, 'recovered-fixture', config);
    expect(result.commit).toBe(saved.commit);
    expect(execFileSync('git', ['rev-parse', 'recovered-fixture'], { cwd: repo, encoding: 'utf8' }).trim()).toBe(saved.commit);
    expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()).toBe(before);
    await expect(restoreWorktreeRecovery(repo, saved.ref, 'recovered-fixture', config)).rejects.toThrow('not created');
    await expect(restoreWorktreeRecovery(repo, 'refs/heads/main', 'bad', config)).rejects.toThrow('managed');
  });

  test('conflict inspection reports real unmerged stages without choosing ours/theirs', async () => {
    const conflictRepo = join(container, 'conflict-repo'); execFileSync('git', ['init', conflictRepo]);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: conflictRepo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('config', 'user.name', 'CCPT Fixture'); git('config', 'user.email', 'fixture@ccpt.local');
    await writeFile(join(conflictRepo, 'conflict.txt'), 'base\n'); git('add', 'conflict.txt'); git('commit', '-m', 'base');
    const main = git('branch', '--show-current'); git('checkout', '-b', 'feature');
    await writeFile(join(conflictRepo, 'conflict.txt'), 'feature\n'); git('commit', '-am', 'feature'); git('checkout', main);
    await writeFile(join(conflictRepo, 'conflict.txt'), 'integration\n'); git('commit', '-am', 'integration');
    expect(() => git('merge', 'feature')).toThrow();
    const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [conflictRepo];
    expect(await inspectGitConflicts(conflictRepo, config)).toEqual([{ path: 'conflict.txt', stages: [1, 2, 3] }]);
    expect(await readFile(join(conflictRepo, 'conflict.txt'), 'utf8')).toContain('<<<<<<<');
  });
});
