import { test, expect } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookOnce } from '../src/hookOnce.js';
import { createRoutine, startRoutineRun, scheduleWakeup, setSessionGoal, listRoutines, listWakeups, listSessionGoals, listRoutineRuns } from '../src/automation.js';
import { repairAutomationState, validateAutomationState } from '../src/automationRecovery.js';
import { refreshResourceGroups, resourceItems, type ResourceDialogState } from '../src/components/resourceDialog.js';
import { extensionStateWatchPaths, watchLocalState } from '../src/localStateWatch.js';
import { defaultConfig } from './legacyFixtureConfig.js';
import { conflictVersions } from '../src/worktree.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
const { BridgeTransport } = createRequire(import.meta.url)('../vscode-extension/bridge.cjs');
const until = async (condition: () => boolean) => { const deadline = Date.now() + 4000; while (!condition() && Date.now() < deadline) await Bun.sleep(10); expect(condition()).toBe(true); };
async function fixture(operation: (root: string) => Promise<void>) { const root = await mkdtemp(join(tmpdir(), 'ccpt-remaining-')); try { await operation(root); } finally { await removeOwnedTemporaryFixture(root); } }

test('durable Hook once serializes six real processes and keeps commands out of receipts', () => fixture(async root => {
  const output = join(root, 'executions.txt');
  const children = Array.from({ length: 6 }, () => Bun.spawn([process.execPath, join(import.meta.dir, 'hook-once-worker.ts'), root, output], { stdout: 'pipe', stderr: 'pipe' }));
  const errors = children.map(child => new Response(child.stderr).text());
  expect(await Promise.all(children.map(child => child.exited))).toEqual([0,0,0,0,0,0]); await Promise.all(errors);
  expect(await readFile(output, 'utf8')).toBe('executed\n');
  const receipts = await readdir(join(root, '.ccpt/hooks-once'));
  expect(receipts).toHaveLength(1);
  const content = await readFile(join(root, '.ccpt/hooks-once', receipts[0]!), 'utf8');
  expect(content).toContain('completed'); expect(content).not.toContain('PRIVATE-HOOK');
}), 15000);

test('failed or damaged Hook once receipts fail closed instead of repeating ambiguous effects', () => fixture(async root => {
  let effects = 0;
  await expect(runHookOnce(root, 'failed', async () => { effects++; throw new Error('first failure'); })).rejects.toThrow('first failure');
  await expect(runHookOnce(root, 'failed', async () => { effects++; })).rejects.toThrow('inspect receipt');
  expect(effects).toBe(1);
  const file = (await readdir(join(root, '.ccpt/hooks-once')))[0]!;
  await writeFile(join(root, '.ccpt/hooks-once', file), '{broken');
  await expect(runHookOnce(root, 'failed', async () => { effects++; })).rejects.toThrow(); expect(effects).toBe(1);
}));

test('checkpoint repair uses CAS, retains corrupt bytes and pauses every kind of pending work', () => fixture(async root => {
  const routine = await createRoutine({ name: 'fixture', prompt: 'PRIVATE-ROUTINE' }, root);
  await startRoutineRun(routine.id, {}, root);
  await scheduleWakeup({ sessionId: 'session_1111111111111111', prompt: 'PRIVATE-WAKEUP', runAt: new Date(Date.now() + 60000).toISOString() }, root);
  await setSessionGoal({ sessionId: 'session_1111111111111111', objective: 'PRIVATE-GOAL' }, root);
  const path = join(root, '.ccpt/automation.json'); await writeFile(path, '{broken');
  const preview = await repairAutomationState(root);
  if (preview.repaired) throw new Error('Preview unexpectedly repaired state');
  expect(preview.repaired).toBe(false); expect(JSON.stringify(preview)).not.toContain('PRIVATE-');
  expect(await readFile(path, 'utf8')).toBe('{broken');
  await expect(repairAutomationState(root, { confirm: true, expectedDigest: 'bad' })).rejects.toThrow('digest');
  const repaired = await repairAutomationState(root, { confirm: true, expectedDigest: preview.expectedDigest! });
  expect(repaired.repaired).toBe(true);
  expect(await readFile(join((repaired as { backup: string }).backup, 'corrupt.json'), 'utf8')).toBe('{broken');
  expect((await listRoutines(root))[0]!.enabled).toBe(false); expect((await listWakeups(root))[0]!.status).toBe('cancelled');
  expect((await listSessionGoals(undefined, root))[0]!.status).toBe('cancelled'); expect((await listRoutineRuns(root))[0]!.status).toBe('failed');
  await expect(repairAutomationState(root)).rejects.toThrow('valid; repair refused');
}));

test('invalid records and tampered checkpoints cannot authorize a recovery', () => fixture(async root => {
  expect(() => validateAutomationState({ wakeups: [null] })).toThrow();
  expect(() => validateAutomationState({ runs: 'bad' })).toThrow();
  await createRoutine({ name: 'fixture', prompt: 'private' }, root);
  const path = join(root, '.ccpt/automation.json'); await writeFile(path, '{broken');
  const checkpoint = JSON.parse(await readFile(path + '.checkpoint', 'utf8')); checkpoint.state.routines[0].prompt = 'modified';
  await writeFile(path + '.checkpoint', JSON.stringify(checkpoint));
  await expect(repairAutomationState(root)).rejects.toThrow('integrity'); expect(await readFile(path, 'utf8')).toBe('{broken');
}));

function fakeBridge(options: Record<string, unknown> = {}) {
  const children: any[] = [], notifications: any[] = [];
  const transport = new BridgeTransport('fixture', 'fixture', { fire: (value: unknown) => notifications.push(value) }, {
    retryMs: 10, requestTimeoutMs: 500, ...options,
    spawn: () => {
      const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.requests = [];
      child.kill = () => { child.killed = true; child.emit('exit', 0); child.stdout.end(); child.stderr.end(); };
      child.stdin = new Writable({ write(chunk, _encoding, done) {
        const request = JSON.parse(String(chunk)); child.requests.push(request);
        if (request.method === 'project/watch' || request.method === 'plan/list') child.stdout.write(JSON.stringify({ id: request.id, result: request.method === 'project/watch' ? { watching: true } : [] }) + '\n');
        done();
      } });
      children.push(child); queueMicrotask(() => child.emit('spawn')); return child;
    },
  });
  return { transport, children, notifications };
}

test('IDE reconnect resubscribes and invalidates snapshots, without replaying chat or approval', async () => {
  const { transport, children, notifications } = fakeBridge();
  try {
    await until(() => notifications.length > 0);
    expect(await transport.request('plan/list')).toEqual([]); // Synchronous reply must not race registration.
    const chat = transport.request('chat/send', { prompt: 'private' }).catch((error: Error) => error.message);
    const approval = transport.request('plan/decide', { id: 'plan', expectedVersion: 1 }).catch((error: Error) => error.message);
    children[0].emit('exit', 1);
    expect(await chat).toContain('not replayed'); expect(await approval).toContain('not replayed');
    await until(() => children.length === 2 && notifications.length >= 2);
    expect(children[1].requests.map((item: any) => item.method)).toEqual(['project/watch']);
    expect(await transport.request('plan/list')).toEqual([]);
    transport.dispose(); await Bun.sleep(60); expect(children).toHaveLength(2);
  } finally { transport.dispose(); }
});

test('IDE timeout rejects without replay/cancellation and dispose rejects pending requests', async () => {
  const { transport, children } = fakeBridge({ requestTimeoutMs: 20 });
  try {
    await until(() => transport.connected);
    let error = ''; try { await transport.request('chat/send'); } catch (value) { error = String(value); }
    expect(error).toContain('not cancelled or replayed'); expect(children).toHaveLength(1);
    const pending = transport.request('plan/decide').catch((value: Error) => value.message); transport.dispose();
    expect(await pending).toContain('disposed'); expect(transport.pending.size).toBe(0);
  } finally { transport.dispose(); }
});

test('live resource updates insert and remove rows while preserving filtered selection by ID', () => {
  const item = (id: string) => ({ id, label: id, description: '' });
  const dialog: ResourceDialogState = { type: 'resource', kind: 'teams', title: 'fixture', query: '', selected: 1, tab: 0, tabs: ['Members'], groups: [[item('a'), item('b')]], expanded: true, cwd: '.', allProjects: false };
  refreshResourceGroups(dialog, [[item('new'), item('a'), item('b')]]);
  expect(resourceItems(dialog)[dialog.selected]!.id).toBe('b'); expect(dialog.expanded).toBe(true);
  refreshResourceGroups(dialog, [[item('new')]]); expect(dialog.selected).toBe(0); expect(dialog.expanded).toBe(false);
});

test('extension watcher includes configured custom roots and remains bounded', () => fixture(async root => {
  const custom = join(root, 'custom-skills'); await mkdir(custom);
  const config = structuredClone(defaultConfig); config.skillsDirectories = [custom, custom]; config.agentsDirectories = []; config.pluginDirectories = [];
  expect(extensionStateWatchPaths(config)).toEqual([custom]);
  let changes = 0; const stop = watchLocalState(extensionStateWatchPaths(config), () => { changes++; }, { recursive: true, intervalMs: 100, initial: true });
  try { await until(() => changes === 1); await writeFile(join(custom, 'SKILL.md'), 'fixture'); await until(() => changes >= 2); } finally { stop(); }
  config.skillsDirectories = Array.from({ length: 33 }, (_, i) => join(root, String(i)));
  expect(() => extensionStateWatchPaths(config)).toThrow('32');
}));

test('Git binary/delete conflict versions expose side presence and sizes without decoding or mutation', () => fixture(async root => {
  const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root];
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.email', 'fixture@local'); git('config', 'user.name', 'Fixture');
  await writeFile(join(root, 'binary.dat'), Buffer.from([0,1,2])); git('add', 'binary.dat'); git('commit', '-m', 'base');
  git('checkout', '-b', 'side'); await writeFile(join(root, 'binary.dat'), Buffer.from([0,9,8,7])); git('commit', '-am', 'modify');
  git('checkout', 'main'); git('rm', 'binary.dat'); git('commit', '-m', 'delete');
  try { git('merge', 'side'); } catch { /* Actual delete/modify conflict. */ }
  const index = git('ls-files', '--unmerged'), head = git('rev-parse', 'HEAD');
  const result = await conflictVersions(root, 'binary.dat', config);
  expect(result.kind).toBe('delete/modify'); expect(result.versions.map(row => row.present)).toEqual([true,false,true]);
  expect(result.versions[0]!.bytes).toBe(3); expect(result.versions[2]!.bytes).toBe(4);
  expect(git('ls-files', '--unmerged')).toBe(index); expect(git('rev-parse', 'HEAD')).toBe(head);
  await expect(conflictVersions(root, '../outside', config)).rejects.toThrow();
}), 15000);
