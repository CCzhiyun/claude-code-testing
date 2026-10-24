import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { createProjectPlan, linkProjectPlanExecution, loadProjectPlan, transitionProjectPlan } from '../src/plans.js';
import { saveAgent, loadAgent } from '../src/agent.js';
import { executeProjectPlan } from '../src/planExecution.js';
import { createId, readJson, withFileLock, writeJson } from '../src/storage.js';
import { createTask, loadTask, updateTask } from '../src/tasks.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

test('waiting publication waits for linked Task and Plan before another window can resume', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-wait-publication-')), prior = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'state');
  let release!: () => void, entered!: () => void; const gate = new Promise<void>(done => { release = done; }), ready = new Promise<void>(done => { entered = done; });
  let locked: Promise<void> | undefined, publication: Promise<void> | undefined;
  try {
    const plan = await createProjectPlan({ cwd: root, request: 'Waiting publication', content: '# Human input required' });
    await transitionProjectPlan(root, plan.id, 'approved'); await transitionProjectPlan(root, plan.id, 'executing');
    const sessionId = createId('session'), task = await createTask({ teamSessionId: sessionId, title: 'Waiting fixture' });
    await updateTask(task.id, { status: 'in_progress' });
    const now = new Date().toISOString(), record = { id: createId('agent'), sessionId, taskId: task.id, planId: plan.id, cwd: root, goal: 'Fixture', role: 'lead', depth: 0, status: 'working' as const, createdAt: now, updatedAt: now };
    await saveAgent(record); await linkProjectPlanExecution(root, plan.id, record.id);
    locked = withFileLock(join(root, 'state/locks', `task-${task.id}.lock`), async () => { entered(); await gate; });
    await ready; publication = saveAgent({ ...record, status: 'waiting_for_input', result: 'Review required' });
    await Bun.sleep(100); expect((await loadAgent(record.id)).status).toBe('working'); expect((await loadTask(task.id)).status).toBe('in_progress');
    release(); await locked; await publication;
    expect((await loadAgent(record.id)).status).toBe('waiting_for_input'); expect((await loadTask(task.id)).status).toBe('blocked'); expect((await loadProjectPlan(root, plan.id)).status).toBe('blocked');
  } finally { release?.(); await locked; await publication; if (prior === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = prior; await removeOwnedTemporaryFixture(root); }
});

test('a delayed Plan write prevents early publication of completed Agent status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-plan-publication-')); const old = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'state');
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { entered = r; });
  let locked: Promise<void> | undefined, publish: Promise<void> | undefined;
  try {
    const plan = await createProjectPlan({ cwd: root, request: 'Fixture', content: '# Fixture' });
    await transitionProjectPlan(root, plan.id, 'approved'); await transitionProjectPlan(root, plan.id, 'executing');
    const now = new Date().toISOString();
    const agent = { id: createId('agent'), sessionId: createId('session'), planId: plan.id, goal: 'Fixture', role: 'lead', depth: 0, cwd: root, status: 'working' as const, createdAt: now, updatedAt: now };
    await saveAgent(agent);
    await linkProjectPlanExecution(root, plan.id, agent.id);
    locked = withFileLock(join(root, '.ccpt', 'plans', 'index.json.lock'), async () => { entered(); await gate; });
    await ready; publish = saveAgent({ ...agent, status: 'completed', result: 'Done' });
    await Bun.sleep(100); expect((await loadAgent(agent.id)).status).toBe('working');
    release(); await locked; await publish;
    expect((await loadAgent(agent.id)).status).toBe('completed'); expect((await loadProjectPlan(root, plan.id)).status).toBe('completed');
  } finally { release?.(); await locked; await publish; if (old === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = old; await rm(root, { recursive: true, force: true }); }
});

test('approved Plan execution retains restricted policy in the worker configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-plan-restricted-')); const old = process.env.CCPT_HOME, oldCli = process.env.CCPT_CLI_ENTRY;
  process.env.CCPT_HOME = join(root, 'state'); process.env.CCPT_CLI_ENTRY = join(import.meta.dir, '../src/cli.ts');
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ choices: [{ message: { content: 'Read-only outcome', finish_reason: 'stop' } }] }) });
  try {
    const config = structuredClone(defaultConfig); config.policy.mode = 'restricted'; config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none'; config.hooks = []; config.marketplaceEnabled = false;
    config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}`;
    await writeJson(join(root, '.ccpt', 'settings.json'), config);
    const plan = await createProjectPlan({ cwd: root, request: 'Fixture', content: '# Restricted fixture' }); await transitionProjectPlan(root, plan.id, 'approved');
    const agent = await executeProjectPlan({ cwd: root, planId: plan.id, background: false });
    const runtime = await readJson<any>(join(root, 'state', 'agents-runtime', `${agent.id}.json`), null);
    expect(runtime.policy.mode).toBe('restricted'); expect(agent.status).toBe('completed');
  } finally { server.stop(true); if (old === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = old; if (oldCli === undefined) delete process.env.CCPT_CLI_ENTRY; else process.env.CCPT_CLI_ENTRY = oldCli; await removeOwnedTemporaryFixture(root); }
}, 20000);
