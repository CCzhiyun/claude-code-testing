import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSession, loadSession } from '../src/sessions.js';
import { scheduleWakeup, listWakeups } from '../src/automation.js';
import { prepareAutomationScheduler, schedulerTaskXml, tickAutomationScheduler, installAutomationScheduler, disableAutomationScheduler } from '../src/automationScheduler.js';
import { trustWorkspace } from '../src/workspaceTrust.js';
import { publishProjectInvalidation, projectEventsAfter } from '../src/projectEvents.js';
import { createProjectPlan } from '../src/plans.js';
import { setGlobalExtensionTrust } from '../src/globalExtensionTrust.js';
import { loadConfig, defaultConfig, setSessionOverrides } from '../src/config.js';
import { loadPlatform } from '../src/platform.js';
import { runHooks } from '../src/hooks.js';
import { spawnAgent } from '../src/agent.js';
import { writeJson } from '../src/storage.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
async function fixture(action: (root: string, home: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-foundation-056-')), previous = process.env.CCPT_HOME, home = join(root, 'home'); process.env.CCPT_HOME = home;
  await writeJson(join(root, '.ccpt/settings.json'), { marketplaceEnabled: false, disableBundledSkills: true, hooks: [] });
  try { await action(root, home); } finally { setSessionOverrides({}); if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await removeOwnedTemporaryFixture(root); }
}
const entry = join(import.meta.dir, '../src/cli.ts');
async function due(root: string) {
  const session = await createSession('fixture', root);
  await scheduleWakeup({ sessionId: session.id, prompt: 'PRIVATE-WAKEUP', runAt: new Date(Date.now()+60000).toISOString() }, root);
  const path = join(root, '.ccpt/automation.json'), state = JSON.parse(await readFile(path, 'utf8')); state.wakeups[0].runAt = '2020-01-01T00:00:00Z'; await writeJson(path, state);
  return session;
}

test('scheduler preparation is explicit/trusted and XML contains no elevation or model command', () => fixture(async root => {
  await expect(prepareAutomationScheduler(root, entry)).rejects.toThrow('Trust'); await trustWorkspace(root);
  const prepared = await prepareAutomationScheduler(root, entry, 7);
  const xml = await readFile(prepared.definition, 'utf8');
  if(process.platform==='win32'){expect(xml).toContain('PT7M');expect(xml).toContain('IgnoreNew');expect(xml).toContain('LeastPrivilege');expect(xml).toContain('InteractiveToken');expect(xml).not.toContain('SYSTEM</');}
  else if(process.platform==='linux'){expect(xml).toContain('Type=oneshot');expect(xml).toContain('NoNewPrivileges=true');}
  else expect(xml).toContain('<key>StartInterval</key><integer>420</integer>');
  expect(xml).toContain('_automation_tick'); expect(prepared.installed).toBe(false);
  await expect(installAutomationScheduler(prepared.id, false)).rejects.toThrow('confirm');
}));

test('scheduler tick delivers once across independent invocations and never calls a model', () => fixture(async root => {
  await trustWorkspace(root); const session = await due(root); const prepared = await prepareAutomationScheduler(root, entry);
  const [a,b] = await Promise.all([tickAutomationScheduler(prepared.id), tickAutomationScheduler(prepared.id)]);
  expect(a.delivered + b.delivered).toBe(1); expect((await listWakeups(root))[0]!.status).toBe('delivered');
  const saved = await loadSession(session.id); expect(saved.messages).toHaveLength(1); expect(JSON.stringify(saved)).toContain('PRIVATE-WAKEUP');
  expect((await tickAutomationScheduler(prepared.id)).delivered).toBe(0);
  await disableAutomationScheduler(prepared.id, true); expect((await tickAutomationScheduler(prepared.id)).disabled).toBe(true);
}));

test('scheduler skips busy sessions and refuses cross-workspace delivery', () => fixture(async (root, home) => {
  await trustWorkspace(root); const session = await due(root), prepared = await prepareAutomationScheduler(root, entry);
  const now = new Date().toISOString();
  await writeJson(join(home, 'agents/agent_1111111111111111.json'), { id: 'agent_1111111111111111', cwd: root, sessionId: session.id, role: 'lead', goal: 'fixture', depth: 0, status: 'working', pid: process.pid, heartbeatAt: now, createdAt: now, updatedAt: now });
  expect((await tickAutomationScheduler(prepared.id)).busy).toBe(1); expect((await loadSession(session.id)).messages).toHaveLength(0);
}));

test('opt-in unattended corrupt recovery pauses pending work instead of replaying it', () => fixture(async root => {
  await trustWorkspace(root); await due(root); const job = await prepareAutomationScheduler(root, entry, 5, true);
  await writeFile(join(root, '.ccpt/automation.json'), '{broken'); const result = await tickAutomationScheduler(job.id);
  expect(result.repaired).toBe(true); expect(result.delivered).toBe(0); expect((await listWakeups(root))[0]!.status).toBe('cancelled');
  expect((await readdir(join(root, '.ccpt/automation-recovery'))).length).toBe(1);
}));

test('scheduler XML rejects argument injection and unbounded intervals', () => {
  const job = { version: 1 as const, id: 'scheduler_1111111111111111', cwd: 'C:/workspace', home: 'C:/state', runtime: 'C:/node.exe', entry: 'C:/cli.js', minutes: 5, repairCorrupt: false, enabled: true };
  expect(() => schedulerTaskXml({ ...job, minutes: 0 })).toThrow('interval'); expect(() => schedulerTaskXml({ ...job, entry: 'x" --evil' })).toThrow('argument');
});

test('project event cursors persist and concurrent producers get unique ordered sequences', () => fixture(async root => {
  const cursors = await Promise.all(Array.from({ length: 20 }, () => publishProjectInvalidation(root, 'plans')));
  expect(new Set(cursors).size).toBe(20);
  const first = await projectEventsAfter(root, undefined, 7); expect(first.events).toHaveLength(7); expect(first.hasMore).toBe(true);
  const next = await projectEventsAfter(root, first.cursor, 20); expect(next.events).toHaveLength(13); expect(next.hasMore).toBe(false); expect(next.replayIsAuthorization).toBe(false);
  expect(JSON.stringify(next)).not.toContain('PRIVATE');
}));

test('event gaps/reset and invalid cursors force snapshot refresh without permissions', () => fixture(async root => {
  await publishProjectInvalidation(root, 'workspace');
  const reset = await projectEventsAfter(root, 'events_0000000000000000:999'); expect(reset.reset).toBe(true);
  await expect(projectEventsAfter(root, '../escape')).rejects.toThrow('cursor'); await expect(projectEventsAfter(root, undefined, 10000)).rejects.toThrow('limit');
  const path = join(root, '.ccpt/ide-events.json'), state = JSON.parse(await readFile(path, 'utf8')); state.events[0].secret = 'PRIVATE-EXTRA'; await writeJson(path, state);
  expect(JSON.stringify(await projectEventsAfter(root))).not.toContain('PRIVATE-EXTRA');
}));

test('Plan changes create durable invalidations even without an IDE connected', () => fixture(async root => {
  await createProjectPlan({ cwd: root, request: 'PRIVATE-REQUEST', content: '# PRIVATE-PLAN' });
  const replay = await projectEventsAfter(root); expect(replay.events.some(row => row.topic === 'plans')).toBe(true); expect(JSON.stringify(replay)).not.toContain('PRIVATE');
}));

test('external global Skill directories require user approval and revoke fail closed', () => fixture(async (root, home) => {
  const workspace = join(root, 'workspace'), shared = join(root, 'shared'); await mkdir(workspace); await mkdir(shared);
  await writeJson(join(workspace, '.ccpt/settings.json'), { marketplaceEnabled: false, disableBundledSkills: true });
  await writeFile(join(shared, 'review.md'), '---\nname: shared-review\ndescription: Global fixture\n---\nRead-only knowledge.');
  await writeJson(join(home, 'settings.json'), { skillsDirectories: [shared] });
  await expect(loadConfig(workspace)).rejects.toThrow('not approved'); await setGlobalExtensionTrust(shared, 'skill', true, true);
  const platform = await loadPlatform(workspace); expect(platform.skills.some(skill => skill.name === 'shared-review')).toBe(true);
  await setGlobalExtensionTrust(shared, 'skill', false, true); await expect(loadConfig(workspace)).rejects.toThrow('not approved');
}));

test('trusted global roots never authorize project-controlled outside-directory overrides', () => fixture(async (root, home) => {
  const workspace = join(root, 'workspace'), shared = join(root, 'shared'); await mkdir(workspace); await mkdir(shared);
  await setGlobalExtensionTrust(shared, 'skill', true, true); await writeJson(join(home, 'settings.json'), {});
  await writeJson(join(workspace, '.ccpt/settings.json'), { skillsDirectories: [shared] });
  await expect(loadConfig(workspace)).rejects.toThrow('inside the trusted workspace');
  await expect(setGlobalExtensionTrust(shared, 'skill', true, false)).rejects.toThrow('confirm');
}));

test('Hook tool-name/input aliases feed real matching command payloads', () => fixture(async root => {
  const config = structuredClone(defaultConfig), script = join(import.meta.dir, 'hook-contract-fixture.cjs');
  config.hooks = [{ event: 'PreToolUse', type: 'command', matcher: 'read_*', command: `node "${script}" 0` }];
  const result = await runHooks(config, 'PreToolUse', { tool_name: 'read_file', tool_input: { path: 'fixture' }, sessionId: 'session_fixture' }, root);
  const payload = JSON.parse(result.additionalContext[0]!); expect(payload.tool).toBe('read_file'); expect(payload.tool_input).toEqual({ path: 'fixture' });
}));

test('UserPromptSubmit rejection in the actual Agent loop prevents any model request', () => fixture(async root => {
  let requests = 0; const server = Bun.serve({ port: 0, fetch: () => { requests++; return Response.json({ choices: [{ message: { content: 'unexpected' } }] }); } });
  try {
    const config = structuredClone(defaultConfig); config.model.provider = 'compatible'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`; config.hooks = [{ event: 'UserPromptSubmit', type: 'command', command: `node "${join(import.meta.dir, 'hook-fixture.js')}" block` }]; config.marketplaceEnabled = false; config.disableBundledSkills = true; config.policy.workspaceRoots = [root];
    await writeJson(join(root, '.ccpt/settings.json'), config);
    const agent = await spawnAgent({ goal: 'Blocked prompt fixture', cwd: root, config, background: false, isolation: 'none' });
    expect(agent.status).toBe('waiting_for_input'); expect(requests).toBe(0);
  } finally { server.stop(true); }
}));
