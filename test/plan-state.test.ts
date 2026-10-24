import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from './legacyFixtureConfig.js';
import { executeProjectPlan } from '../src/planExecution.js';
import { createProjectPlan, listPlanRecords, loadProjectPlan, reviseProjectPlan, transitionProjectPlan, updateProjectPlanStep } from '../src/plans.js';
import { writeJson } from '../src/storage.js';

let workspace = '';
let server: ReturnType<typeof Bun.serve>;
let previousHome: string | undefined;
let previousKey: string | undefined;
let previousCliEntry: string | undefined;

async function cli(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'src', 'cli.ts'), ...args, '--cwd', workspace], {
    stdout: 'pipe', stderr: 'pipe', env: { ...process.env, CCPT_HOME: join(workspace, 'state'), CCPT_API_KEY: 'plan-state-key' },
  });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, exitCode };
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'ccpt-plan-state-'));
  previousHome = process.env.CCPT_HOME;
  previousKey = process.env.CCPT_API_KEY;
  previousCliEntry = process.env.CCPT_CLI_ENTRY;
  process.env.CCPT_HOME = join(workspace, 'state');
  process.env.CCPT_API_KEY = 'plan-state-key';
  process.env.CCPT_CLI_ENTRY = join(import.meta.dir, '..', 'src', 'cli.ts');
  server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({ choices: [{ message: { content: 'Approved plan executed with validation.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 14, completion_tokens: 6 } });
    },
  });
  const config = structuredClone(defaultConfig);
  config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.policy.workspaceRoots = [workspace];
  config.agents.defaultIsolation = 'none';
  await writeJson(join(workspace, '.ccpt', 'settings.json'), config);
});

afterAll(async () => {
  server.stop(true);
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  if (previousKey === undefined) delete process.env.CCPT_API_KEY; else process.env.CCPT_API_KEY = previousKey;
  if (previousCliEntry === undefined) delete process.env.CCPT_CLI_ENTRY; else process.env.CCPT_CLI_ENTRY = previousCliEntry;
  await rm(workspace, { recursive: true, force: true });
});

describe.serial('persistent project Plan state machine', () => {
  test('persists versioned approval decisions and supports revision after feedback', async () => {
    const created = await createProjectPlan({
      cwd: workspace,
      request: 'Add durable planning',
      content: '# Durable Planning\n\n- [ ] Add the state store\n- [ ] Verify recovery',
      sessionId: 'session_0000000000000000',
    });
    expect(created.status).toBe('pending_approval');
    expect(created.steps.map((step) => step.title)).toEqual(['Add the state store', 'Verify recovery']);
    await access(resolve(workspace, created.markdownPath));
    expect((await listPlanRecords(workspace))[0]?.id).toBe(created.id);
    await expect(transitionProjectPlan(workspace, created.id, 'completed')).rejects.toThrow('Cannot transition');

    const changes = await transitionProjectPlan(workspace, created.id, 'changes_requested', { expectedVersion: created.version, comment: 'Add a rollback step.' });
    expect(changes.decisionComment).toBe('Add a rollback step.');
    await expect(transitionProjectPlan(workspace, created.id, 'rejected', { expectedVersion: created.version })).rejects.toThrow('changed from version');
    const revised = await reviseProjectPlan(workspace, created.id, '# Durable Planning v2\n\n- [ ] Add the state store\n- [ ] Add rollback\n- [ ] Verify recovery');
    expect(revised.status).toBe('pending_approval');
    expect(revised.version).toBeGreaterThan(changes.version);
    expect((await loadProjectPlan(workspace, created.id)).steps).toHaveLength(3);
  });

  test('tracks individual execution steps and resumable failures', async () => {
    const created = await createProjectPlan({ cwd: workspace, request: 'Track steps', content: '# Track Steps\n\n- [ ] Implement\n- [ ] Test' });
    const approved = await transitionProjectPlan(workspace, created.id, 'approved');
    await transitionProjectPlan(workspace, created.id, 'executing');
    const progressed = await updateProjectPlanStep(workspace, created.id, 'step_001', 'completed', 'Unit implemented');
    expect(progressed.steps[0]).toMatchObject({ status: 'completed', note: 'Unit implemented' });
    const failed = await transitionProjectPlan(workspace, created.id, 'failed', { error: 'Temporary runner outage' });
    expect(failed.error).toContain('runner outage');
    const resumed = await transitionProjectPlan(workspace, created.id, 'executing');
    expect(resumed.status).toBe('executing');
    expect(resumed.version).toBeGreaterThan(approved.version);
  });

  test('executes only an approved plan and automatically records Agent completion', async () => {
    const created = await createProjectPlan({ cwd: workspace, request: 'Execute safely', content: '# Execute Safely\n\n- [ ] Make the approved change\n- [ ] Run validation' });
    await expect(executeProjectPlan({ cwd: workspace, planId: created.id, background: false })).rejects.toThrow('must be approved');
    await transitionProjectPlan(workspace, created.id, 'approved');
    const agent = await executeProjectPlan({ cwd: workspace, planId: created.id, background: false });
    expect(agent.status).toBe('completed');
    expect(agent.result).toBe('Approved plan executed with validation.');
    const completed = await loadProjectPlan(workspace, created.id);
    expect(completed.status).toBe('completed');
    expect(completed.executionAgentId).toBe(agent.id);
    expect(completed.completedAt).toBeDefined();
  }, 15_000);

  test('exposes list, show, approval and rejection through the CLI', async () => {
    const approvedCandidate = await createProjectPlan({ cwd: workspace, request: 'CLI approval', content: '# CLI Approval\n\n- [ ] Confirm' });
    const approval = await cli('plan', 'approve', approvedCandidate.id, 'Reviewed by operator');
    expect(approval.exitCode, approval.stderr).toBe(0);
    expect(JSON.parse(approval.stdout)).toMatchObject({ id: approvedCandidate.id, status: 'approved', decisionComment: 'Reviewed by operator' });
    const shown = await cli('plan', 'show', approvedCandidate.id);
    expect(JSON.parse(shown.stdout).content).toContain('# CLI Approval');

    const rejectedCandidate = await createProjectPlan({ cwd: workspace, request: 'CLI rejection', content: '# CLI Rejection\n\n- [ ] Do not run' });
    const rejection = await cli('plan', 'reject', rejectedCandidate.id, 'Needs a safer approach');
    expect(JSON.parse(rejection.stdout)).toMatchObject({ status: 'rejected', decisionComment: 'Needs a safer approach' });
    const listed = await cli('plan', 'list');
    expect(JSON.parse(listed.stdout).map((plan: { id: string }) => plan.id)).toEqual(expect.arrayContaining([approvedCandidate.id, rejectedCandidate.id]));
  }, 15_000);
});
