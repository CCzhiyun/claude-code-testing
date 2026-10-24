import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, cp, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { DeferredStateReload } from '../src/deferredStateReload.js';
import { projectStateWatchPaths, watchLocalState } from '../src/localStateWatch.js';
import { createRecoveryBackup, inspectRecoveryBackup, importRecoveryBackup } from '../src/recoveryBackup.js';
import { listPluginOrphans, quarantinePluginOrphan } from '../src/pluginOrphans.js';
import { withPluginOperation } from '../src/pluginHistory.js';
import { readTeamMailbox } from '../src/mailbox.js';
import { writeJson } from '../src/storage.js';
import { defaultConfig } from './legacyFixtureConfig.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

const until = async (condition: () => boolean) => { const limit = Date.now() + 5000; while (!condition() && Date.now() < limit) await Bun.sleep(15); expect(condition()).toBe(true); };
async function fixture(operation: (root: string, config: typeof defaultConfig) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-followup-055-')), previous = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'home');
  const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root]; config.marketplaceEnabled = false; config.hooks = []; config.disableBundledSkills = true;
  await writeJson(join(root, '.ccpt/settings.json'), config);
  try { await operation(root, config); } finally { if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await removeOwnedTemporaryFixture(root); }
}
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
const ref = 'refs/ccpt/recovery/agent_1111111111111111/save_1111111111111111';
async function repo(root: string) {
  await mkdir(root); git(root, 'init', '-b', 'main'); git(root, 'config', 'user.email', 'fixture@local'); git(root, 'config', 'user.name', 'Fixture');
  await writeFile(join(root, 'file.txt'), 'portable committed fixture\n'); git(root, 'add', 'file.txt'); git(root, 'commit', '-m', 'fixture');
  const commit = git(root, 'rev-parse', 'HEAD'); git(root, 'update-ref', ref, commit); return commit;
}

test('deferred reload coalesces busy invalidations, waits for idle and stops cleanly', async () => {
  let busy = true, calls = 0;
  const controller = new DeferredStateReload({ busy: () => busy, reload: async () => { calls++; }, onError: () => { throw new Error('unexpected'); } });
  for (let i = 0; i < 100; i++) controller.invalidate();
  await controller.flush(); expect(calls).toBe(0);
  busy = false; await controller.flush(); expect(calls).toBe(1); await controller.flush(); expect(calls).toBe(1);
  controller.dispose(); controller.invalidate(); await controller.flush(); expect(calls).toBe(1);
});

test('changes during an active reload are retained for a second pass, never parallelized', async () => {
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const controller = new DeferredStateReload({ busy: () => false, reload: async () => { calls++; if (calls === 1) await gate; }, onError: () => {} });
  controller.invalidate(); const first = controller.flush(); await Bun.sleep(1); controller.invalidate();
  expect(controller.reloading).toBe(true); expect(controller.flush()).toBe(first);
  release(); await controller.settled(); await controller.flush(); expect(calls).toBe(2); controller.dispose();
});

test('failed reload has no automatic retry storm and retries on a fresh invalidation', async () => {
  let calls = 0, errors = 0;
  const controller = new DeferredStateReload({ busy: () => false, reload: async () => { calls++; throw new Error('broken configuration'); }, onError: () => { errors++; } });
  controller.invalidate(); await controller.flush(); for (let i = 0; i < 20; i++) await controller.flush();
  expect(calls).toBe(1); expect(errors).toBe(1); controller.invalidate(); await controller.flush(); expect(calls).toBe(2); controller.dispose();
});

test('configured root rebinding watches the new directory and drops the old subscription', () => fixture(async root => {
  const a = join(root, 'a'), b = join(root, 'b'); await mkdir(a); await mkdir(b); let calls = 0;
  const controller = new DeferredStateReload({ busy: () => false, reload: async () => { calls++; }, onError: () => {}, intervalMs: 100 });
  const timer = setInterval(() => { void controller.flush(); }, 20);
  try {
    controller.setPaths([a]); await until(() => calls === 1);
    await writeFile(join(a, 'SKILL.md'), 'a'); await until(() => calls === 2);
    controller.setPaths([b]); await until(() => calls === 3);
    await writeFile(join(a, 'old.md'), 'old'); await Bun.sleep(250); expect(calls).toBe(3);
    await writeFile(join(b, 'SKILL.md'), 'b'); await until(() => calls === 4);
    expect(() => controller.setPaths(Array.from({ length: 33 }, (_, i) => join(root, String(i))))).toThrow('bounds');
  } finally { clearInterval(timer); controller.dispose(); }
}));

test('nested inbox and task updates invalidate state; read-only mailbox inspection creates no lock or read receipt', () => fixture(async root => {
  const home = process.env.CCPT_HOME!, session = 'session_1111111111111111', agent = 'agent_1111111111111111';
  await writeJson(join(home, 'agents', `${agent}.json`), { id: agent, sessionId: session, teamSessionId: session, cwd: root, status: 'completed', role: 'lead', goal: 'fixture', depth: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const inbox = join(home, 'teams', session, 'mailboxes', `${agent}.json`);
  await writeJson(inbox, [{ id: 'message_fixture', read: false, content: 'PRIVATE-MAIL', kind: 'message' }]);
  const before = await readFile(inbox, 'utf8'), folder = join(home, 'teams', session, 'mailboxes');
  const entries = await readdir(folder);
  expect(await readTeamMailbox({ teamSessionId: session, agentId: agent, markRead: false })).toHaveLength(1);
  expect(await readFile(inbox, 'utf8')).toBe(before); expect(await readdir(folder)).toEqual(entries);
  let changes = 0;
  const stop = watchLocalState(projectStateWatchPaths(root), () => { changes++; }, { recursive: true, initial: true, intervalMs: 100 });
  try {
    await until(() => changes === 1); await writeJson(inbox, []); await until(() => changes === 2);
    await writeJson(join(home, 'tasks', 'task_1111111111111111.json'), { title: 'new task' }); await until(() => changes === 3);
  } finally { stop(); }
}));

test('complete recovery bundle travels to a different empty repository and creates only a new branch', () => fixture(async (root, config) => {
  const source = join(root, 'source'), destination = join(root, 'destination'), commit = await repo(source);
  await writeFile(join(source, 'untracked-secret.txt'), 'not in bundle');
  const backup = await createRecoveryBackup(source, config, true);
  await mkdir(destination); git(destination, 'init', '-b', 'main');
  const incoming = join(destination, 'incoming'); await cp(backup.directory, incoming, { recursive: true });
  const inspected = await inspectRecoveryBackup(destination, incoming, backup.sha256, config); expect(inspected.manifest.refs[0]!.commit).toBe(commit);
  const head = git(destination, 'symbolic-ref', 'HEAD');
  const result = await importRecoveryBackup({ repo: destination, directory: incoming, expectedSha256: backup.sha256, ref, branch: 'recovered/team', confirmed: true }, config);
  expect(result.commit).toBe(commit); expect(git(destination, 'symbolic-ref', 'HEAD')).toBe(head);
  expect(git(destination, 'show', 'recovered/team:file.txt')).toBe('portable committed fixture');
  expect(git(destination, 'ls-tree', '--name-only', 'recovered/team')).not.toContain('untracked-secret');
  expect(git(destination, 'for-each-ref', '--format=%(refname)')).toBe('refs/heads/recovered/team');
}), 20000);

test('backup export requires explicit consent and nonempty managed refs', () => fixture(async (root, config) => {
  await expect(createRecoveryBackup(root, config, false)).rejects.toThrow('confirm');
  git(root, 'init'); await expect(createRecoveryBackup(root, config, true)).rejects.toThrow('1–128');
}));

test('backup rejects tampered bytes, forged manifest refs and an untrusted expected hash', () => fixture(async (root, config) => {
  const source = join(root, 'source'); await repo(source); const backup = await createRecoveryBackup(source, config, true);
  await expect(inspectRecoveryBackup(source, backup.directory, '', config)).rejects.toThrow('expected-sha256');
  const path = join(backup.directory, 'manifest.json'), manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.refs[0].commit = 'f'.repeat(40); await writeJson(path, manifest);
  await expect(inspectRecoveryBackup(source, backup.directory, backup.sha256, config)).rejects.toThrow('manifest');
  manifest.refs[0].commit = git(source, 'rev-parse', 'HEAD'); await writeJson(path, manifest);
  const bundle = join(backup.directory, 'recovery.bundle'), bytes = await readFile(bundle); bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; await writeFile(bundle, bytes);
  await expect(inspectRecoveryBackup(source, backup.directory, backup.sha256, config)).rejects.toThrow('digest');
}), 15000);

test('recovery import refuses existing branches, missing consent and workspace escapes', () => fixture(async (root, config) => {
  const source = join(root, 'source'); await repo(source); const backup = await createRecoveryBackup(source, config, true);
  const input = { repo: source, directory: backup.directory, expectedSha256: backup.sha256, ref, branch: 'main', confirmed: true };
  const before = git(source, 'rev-parse', 'main');
  await expect(importRecoveryBackup(input, config)).rejects.toThrow('already exists'); expect(git(source, 'rev-parse', 'main')).toBe(before);
  await expect(importRecoveryBackup({ ...input, confirmed: false }, config)).rejects.toThrow('confirm');
  await expect(inspectRecoveryBackup(source, root, backup.sha256, config)).rejects.toThrow('outside permitted');
}), 15000);

test('journal-less staging is inspected as raw bytes and reversibly quarantined without installation', () => fixture(async root => {
  const id = 'install-orphan', staging = join(root, '.ccpt/plugin-transactions', id);
  await mkdir(staging, { recursive: true }); await writeFile(join(staging, 'plugin.json'), '{partial invalid JSON');
  const rows = await listPluginOrphans(root); expect(rows[0]!.inspectable).toBe(true);
  const quarantined = await quarantinePluginOrphan(root, id, rows[0]!.digest!, true);
  expect(quarantined.installed).toBe(false); expect(quarantined.executed).toBe(false);
  expect(await readFile(join(quarantined.directory, 'staging/plugin.json'), 'utf8')).toBe('{partial invalid JSON');
  expect(await listPluginOrphans(root)).toEqual([]);
  await expect(lstat(join(root, '.ccpt/plugins'))).rejects.toThrow();
}));

test('orphan quarantine rejects changed staging, missing consent and journal-bearing transactions', () => fixture(async root => {
  const id = 'replace-orphan', path = join(root, '.ccpt/plugin-transactions', id);
  await mkdir(path, { recursive: true }); await writeFile(join(path, 'data'), 'before');
  const row = (await listPluginOrphans(root))[0]!;
  await expect(quarantinePluginOrphan(root, id, row.digest!, false)).rejects.toThrow('confirm');
  await writeFile(join(path, 'data'), 'changed'); await expect(quarantinePluginOrphan(root, id, row.digest!, true)).rejects.toThrow('changed');
  await writeJson(join(path, 'journal.json'), {}); expect(await listPluginOrphans(root)).toEqual([]);
  await expect(quarantinePluginOrphan(root, id, row.digest!, true)).rejects.toThrow('Journal exists');
}));

test('unknown legacy operation ownership prevents orphan moves', () => fixture(async root => {
  const id = 'install-owned', staging = join(root, '.ccpt/plugin-transactions', id);
  await mkdir(staging, { recursive: true }); await writeFile(join(staging, 'data'), 'fixture');
  const row = (await listPluginOrphans(root))[0]!;
  await writeJson(join(root, '.ccpt/plugin-operations/project-somebody.lock'), { pid: process.pid });
  await expect(quarantinePluginOrphan(root, id, row.digest!, true)).rejects.toThrow('lock exists');
  expect((await lstat(staging)).isDirectory()).toBe(true);
}));

test('maintenance gate waits for an active installer before orphan containment', () => fixture(async root => {
  const id = 'install-wait', staging = join(root, '.ccpt/plugin-transactions', id);
  await mkdir(staging, { recursive: true }); await writeFile(join(staging, 'data'), 'fixture');
  const row = (await listPluginOrphans(root))[0]!;
  let release!: () => void, entered = false, moved = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const install = withPluginOperation(root, 'fixture', 'project', async () => { entered = true; await gate; });
  await until(() => entered);
  const quarantine = quarantinePluginOrphan(root, id, row.digest!, true).then(() => { moved = true; });
  await Bun.sleep(100); expect(moved).toBe(false); release(); await install; await quarantine; expect(moved).toBe(true);
}));

test('oversized orphan data is retained for manual inspection, not loaded as a plugin', () => fixture(async root => {
  const path = join(root, '.ccpt/plugin-transactions/install-large'); await mkdir(path, { recursive: true });
  await writeFile(join(path, 'large'), Buffer.alloc(4 * 1024 * 1024 + 1));
  const row = (await listPluginOrphans(root))[0]!; expect(row.inspectable).toBe(false); expect(row.digest).toBeUndefined();
}));
