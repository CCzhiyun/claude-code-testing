import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { createId, writeJson } from '../src/storage.js';
import { continueAgent, loadAgent, saveAgent, spawnAgent, waitForAgent } from '../src/agent.js';
import { createProjectPlan, linkProjectPlanExecution, loadProjectPlan, transitionProjectPlan } from '../src/plans.js';
import { executeProjectPlan, recoverProjectPlanExecution } from '../src/planExecution.js';
import { createTask, loadTask, updateTask } from '../src/tasks.js';
import { loadSession } from '../src/sessions.js';
import { executeTool } from '../src/tooling.js';
import { runHooks } from '../src/hooks.js';
import type { HookEvent } from '../src/types.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

const fixture = join(import.meta.dir, 'completion-gate-fixture.cjs');
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-plan-quality-'));
  const previous = { home: process.env.CCPT_HOME, entry: process.env.CCPT_CLI_ENTRY };
  process.env.CCPT_HOME = join(root, 'state'); process.env.CCPT_CLI_ENTRY = join(import.meta.dir, '../src/cli.ts');
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(await request.json());
    return Response.json({ choices: [{ message: { content: `Validated outcome ${requests.length}` }, finish_reason: 'stop' }] });
  } });
  const config = structuredClone(defaultConfig);
  config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/chat/completions`;
  config.model.apiKeyEnv = '';
  config.agents.defaultIsolation = 'none'; config.agents.maxTurns = 12; config.agents.maxConcurrent = 8;
  config.marketplaceEnabled = false; config.disableBundledSkills = true; config.hooks = [];
  config.policy.workspaceRoots = [root]; config.network.allowedHosts = ['127.0.0.1'];
  const persist = () => writeJson(join(root, '.ccpt', 'settings.json'), config);
  const gate = (event: HookEvent, mode: string) => { config.hooks = [{ event, command: `node "${fixture}" ${mode}` }]; };
  const close = async () => {
    server.stop(true);
    for (const [name, value] of [['CCPT_HOME', previous.home], ['CCPT_CLI_ENTRY', previous.entry]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await removeOwnedTemporaryFixture(root);
  };
  await persist(); return { root, requests, config, persist, gate, close };
}

test('simultaneous execution reserves one Plan and launches exactly one worker', async () => {
  const f = await setup();
  try {
    const plan = await createProjectPlan({ cwd: f.root, request: 'One execution only', content: '# Concurrent execution' });
    await transitionProjectPlan(f.root, plan.id, 'approved');
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => executeProjectPlan({ cwd: f.root, planId: plan.id })));
    const success = outcomes.filter((outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof executeProjectPlan>>> => outcome.status === 'fulfilled');
    expect(success).toHaveLength(1);
    const agent = await waitForAgent(success[0]!.value.id);
    expect(agent.status).toBe('completed'); expect(f.requests).toHaveLength(1);
    expect(await loadProjectPlan(f.root, plan.id)).toMatchObject({ status: 'completed', executionAgentId: agent.id });
    await expect(linkProjectPlanExecution(f.root, plan.id, createId('agent'))).rejects.toThrow('not executing');
    // Continuing a completed execution starts a normal turn, not a stale Plan claim.
    expect((await continueAgent(agent.id, 'Explain the result', { config: f.config })).status).toBe('completed');
  } finally { await f.close(); }
}, 20000);

for (const event of ['TaskCompleted', 'TeammateIdle'] as const) test(`${event} exit 2 feeds back before Agent/task/Plan completion`, async () => {
  const f = await setup(); f.gate(event, 'block-first'); await f.persist();
  try {
    const plan = await createProjectPlan({ cwd: f.root, request: 'Pass quality gate', content: '# Quality evidence' });
    await transitionProjectPlan(f.root, plan.id, 'approved');
    const agent = await executeProjectPlan({ cwd: f.root, planId: plan.id, background: false });
    expect(agent.status).toBe('completed'); expect(f.requests).toHaveLength(2);
    expect(JSON.stringify(f.requests[1])).toContain('Quality evidence missing');
    expect((await loadTask(agent.taskId!)).status).toBe('completed');
    expect((await loadProjectPlan(f.root, plan.id)).status).toBe('completed');
    const payload = JSON.parse(await readFile(join(f.root, `gate-${agent.id}-${event}.json`), 'utf8'));
    expect(payload).toMatchObject({ task_id: agent.taskId, agent_id: agent.id, session_id: agent.sessionId, hook_event_name: event });
    expect(payload.task_subject).toBeTruthy();
    expect(JSON.stringify((await loadSession(agent.sessionId)).messages)).toContain('Completion has NOT been accepted');
  } finally { await f.close(); }
}, 20000);

test('persistent gate failure preserves a blocked Plan/session; explicit continuation can pass', async () => {
  const f = await setup(); f.gate('TaskCompleted', 'always-block'); f.config.agents.maxTurns = 2; await f.persist();
  try {
    const plan = await createProjectPlan({ cwd: f.root, request: 'Never publish false success', content: '# Blocked quality gate' });
    await transitionProjectPlan(f.root, plan.id, 'approved');
    const agent = await executeProjectPlan({ cwd: f.root, planId: plan.id, background: false });
    expect(agent.status).toBe('waiting_for_input'); expect(agent.error).toBeUndefined(); expect(f.requests).toHaveLength(2);
    expect((await loadTask(agent.taskId!)).status).toBe('blocked');
    expect((await loadProjectPlan(f.root, plan.id)).status).toBe('blocked');
    f.config.hooks = []; await f.persist();
    const next = await continueAgent(agent.id, 'The verifier has been repaired; revalidate', { config: f.config });
    expect(next.id).toBe(agent.id); expect(next.sessionId).toBe(agent.sessionId); expect(next.status).toBe('completed');
    expect((await loadProjectPlan(f.root, plan.id)).status).toBe('completed');
  } finally { await f.close(); }
}, 20000);

test('continue:false stops without retry or fake completion and async gates fail closed', async () => {
  const f = await setup(); f.gate('TeammateIdle', 'stop'); await f.persist();
  try {
    const stopped = await spawnAgent({ cwd: f.root, goal: 'Inspect quality', config: f.config, background: false });
    expect(stopped.status).toBe('waiting_for_input'); expect(stopped.result).toContain('Operator must inspect'); expect(f.requests).toHaveLength(1);
    expect((await loadTask(stopped.taskId!)).status).toBe('blocked');
    f.config.hooks = [{ event: 'TaskCompleted', command: `node "${fixture}" pass`, async: true }];
    await expect(runHooks(f.config, 'TaskCompleted', {}, f.root)).rejects.toThrow('cannot enforce completion');
  } finally { await f.close(); }
}, 15000);

test('explicit Plan re-execution resumes its existing execution Agent and conversation', async () => {
  const f = await setup(); f.gate('TaskCompleted', 'stop'); await f.persist();
  try {
    const plan = await createProjectPlan({ cwd: f.root, request: 'Keep original conversation', content: '# Resume execution owner' });
    await transitionProjectPlan(f.root, plan.id, 'approved');
    const first = await executeProjectPlan({ cwd: f.root, planId: plan.id, background: false });
    expect(first.status).toBe('waiting_for_input');
    f.config.hooks = []; await f.persist();
    const next = await executeProjectPlan({ cwd: f.root, planId: plan.id, background: false });
    expect(next.id).toBe(first.id); expect(next.sessionId).toBe(first.sessionId); expect(next.status).toBe('completed');
    expect(JSON.stringify(f.requests[1])).toContain('Completion has NOT been accepted');
    expect((await loadProjectPlan(f.root, plan.id)).executionAgentId).toBe(first.id);
  } finally { await f.close(); }
}, 20000);

test('concurrent teammates never skip each other’s quality gates', async () => {
  const f = await setup(); f.gate('TaskCompleted', 'delay-block');
  try {
    const outcomes = await Promise.allSettled(['first', 'second'].map(agentId => runHooks(f.config, 'TaskCompleted', { agentId }, f.root)));
    expect(outcomes.map(item => item.status)).toEqual(['rejected', 'rejected']);
  } finally { await f.close(); }
});

test('task_update runs completion gate before writing and concurrent task patches do not lose fields', async () => {
  const f = await setup(); f.gate('TaskCompleted', 'always-block');
  try {
    const task = await createTask({ teamSessionId: 'fixture-team', title: 'Explicit completion gate' });
    await expect(executeTool('task_update', { task_id: task.id, status: 'completed' }, { cwd: f.root, agentId: createId('agent'), sessionId: 'fixture-team', teamSessionId: 'fixture-team', depth: 0, config: f.config }, async () => '')).rejects.toThrow('Quality evidence missing');
    expect((await loadTask(task.id)).status).toBe('queued');
    await Promise.all([updateTask(task.id, { result: 'Durable result' }), updateTask(task.id, { ownerAgentId: 'owner' })]);
    expect(await loadTask(task.id)).toMatchObject({ result: 'Durable result', ownerAgentId: 'owner' });
  } finally { await f.close(); }
});

test('explicit recovery settles stranded executions without replaying or stealing live ownership', async () => {
  const f = await setup();
  try {
    const orphan = await createProjectPlan({ cwd: f.root, request: 'Interrupted reservation', content: '# Interrupted launch' });
    await transitionProjectPlan(f.root, orphan.id, 'approved'); await transitionProjectPlan(f.root, orphan.id, 'executing');
    expect((await recoverProjectPlanExecution(f.root, orphan.id)).status).toBe('blocked'); expect(f.requests).toHaveLength(0);
    const agentId = createId('agent'); const now = new Date().toISOString();
    await transitionProjectPlan(f.root, orphan.id, 'executing'); await linkProjectPlanExecution(f.root, orphan.id, agentId);
    await expect(linkProjectPlanExecution(f.root, orphan.id, createId('agent'))).rejects.toThrow('already has');
    await expect(transitionProjectPlan(f.root, orphan.id, 'completed', { expectedExecutionAgentId: createId('agent') })).rejects.toThrow('another execution');
    const agent = { id: agentId, cwd: f.root, sessionId: createId('session'), planId: orphan.id, role: 'lead', depth: 0, goal: 'Recover existing worker', status: 'working' as const, pid: process.pid, heartbeatAt: now, createdAt: now, updatedAt: now };
    await saveAgent(agent); expect((await recoverProjectPlanExecution(f.root, orphan.id)).status).toBe('executing');
    await saveAgent({ ...agent, status: 'failed', error: 'Worker interrupted' });
    expect((await recoverProjectPlanExecution(f.root, orphan.id)).status).toBe('failed'); expect(f.requests).toHaveLength(0);
    expect((await loadAgent(agent.id)).status).toBe('failed');
  } finally { await f.close(); }
});
