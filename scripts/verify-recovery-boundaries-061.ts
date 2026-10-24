// Verification only: interrupted records are injected into an owned temporary
// workspace. No real OS scheduler, external provider, push, or user profile.
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { trustWorkspace } from '../src/workspaceTrust.js';
import { createSession } from '../src/sessions.js';
import { setSessionGoal } from '../src/automation.js';
import { createProjectPlan, transitionProjectPlan } from '../src/plans.js';
import { prepareGoalWorkflow } from '../src/goalWorkflow.js';
import { beginToolOperation, finishToolOperation, inspectOperation, queryOperation, registerOperationConnector, compensateOperation, resolveOperation } from '../src/operationRecovery.js';
import { startHookFileWatch } from '../src/hookFileWatch.js';
import { removeOwnedTemporaryFixture } from '../test/fixtureCleanup.js';
import type { ToolContext } from '../src/types.js';

const project = resolve(import.meta.dir, '..');
const output = resolve(process.env.CCPT_VERIFICATION_OUTPUT ?? join(project, '.ccpt/implementation-061/boundaries'));
const root = await mkdtemp(join(tmpdir(), 'ccpt-verify-boundaries-060-'));
const oldHome = process.env.CCPT_HOME;
const home = join(root, 'home');
process.env.CCPT_HOME = home;
const env: Record<string, string> = { CCPT_HOME: home };
for (const key of ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[key]) env[key] = process.env[key]!;
const entry = join(project, 'dist/cli.js');
async function cli(args: string[]) {
  const child = Bun.spawn(['node', entry, ...args, '--cwd', root], { cwd: root, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill(), 20000);
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { out, err, code };
  } finally { clearTimeout(timer); }
}
try {
  const config = structuredClone(defaultConfig);
  config.marketplaceEnabled = false; config.disableBundledSkills = true; config.hooks = [];
  config.model.apiKeyEnv = ''; config.model.endpointUrl = 'http://127.0.0.1:1/v1/responses';
  config.model.apiProtocol = 'responses'; config.model.responsesTransport = 'native';
  config.policy.workspaceRoots = [root];
  await writeJson(join(root, '.ccpt/settings.json'), config);
  await trustWorkspace(root);
  const session = await createSession('Crash recovery boundary verification', root);
  const goal = await setSessionGoal({ sessionId: session.id, objective: 'Verify recovery without replay' }, root);
  const plan = await createProjectPlan({ cwd: root, sessionId: session.id, request: 'Verification fixture', content: '# Fixture\n- [ ] Verify interrupted owner' });
  const approved = await transitionProjectPlan(root, plan.id, 'approved', { expectedVersion: plan.version });
  const run = await prepareGoalWorkflow(root, { goalId: goal.id, planId: plan.id, expectedPlanVersion: approved.version, maxRequests: 2, maxTokens: 10000, allowedTools: ['read_file'] });
  const agentId = 'agent_6060606060606060';
  const exited = Bun.spawn(['node', '-e', 'process.exit(0)'], { env, stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  assert.equal(await exited.exited, 0);
  // Probe only our own exited child; never signal or kill unrelated processes.
  let alive = false; try { process.kill(exited.pid, 0); alive = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  assert.equal(alive, false, 'Owned fixture child must actually have exited');
  await transitionProjectPlan(root, plan.id, 'executing', { expectedVersion: approved.version, executionAgentId: agentId });
  const now = new Date().toISOString();
  await writeJson(join(home, 'agents', agentId + '.json'), { id: agentId, sessionId: session.id, planId: plan.id, cwd: root, goal: 'Crash fixture', role: 'lead', depth: 0, status: 'working', pid: exited.pid, heartbeatAt: now, createdAt: now, updatedAt: now, workflowBudget: run.budget });
  const runFile = join(root, '.ccpt/goal-runs', run.id + '.json');
  const durable = JSON.parse(await readFile(runFile, 'utf8'));
  durable.phase = 'running'; durable.attempts = 1; durable.version++;
  await writeJson(runFile, durable);
  const direct = await cli(['goal-run', 'recover', run.id, '--expected-version', String(durable.version)]);
  assert.equal(direct.code,0,direct.err);
  const directRecovery=JSON.parse(direct.out);assert.equal(directRecovery.phase,'unknown');assert.equal(directRecovery.requests,0);
  const listed = await cli(['agents']); assert.equal(listed.code, 0, listed.err);
  assert.equal(JSON.parse(listed.out).find((item: any) => item.id === agentId)?.status, 'failed');
  const reconciled = await cli(['goal-run', 'show', run.id]);
  assert.equal(reconciled.code, 0, reconciled.err);
  const recovered = JSON.parse(reconciled.out);
  assert.equal(recovered.phase, 'unknown'); assert.equal(recovered.attempts, 1); assert.equal(recovered.requests, 0);
  const stale = await cli(['goal-run', 'recover', run.id, '--expected-version', String(durable.version)]);
  assert.equal(stale.code, 1); assert.match(stale.err, /changed/);

  const ctx: ToolContext = { cwd: root, config, sessionId: session.id, agentId, operationId: 'same-provider-call', depth: 0 };
  const claims = await Promise.allSettled(Array.from({ length: 12 }, () => beginToolOperation(ctx, 'git_push', { remote: 'fixture-only' })));
  assert.equal(claims.filter(row => row.status === 'fulfilled').length, 1);
  const claim = claims.find(row => row.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof beginToolOperation>>>;
  const op = claim.value!; await finishToolOperation(ctx, op, 'Local fixture receipt, no Git command executed', true);
  let compensations = 0;
  const unregister = registerOperationConnector('git_push', { inspect: async () => ({ verified: false }), compensate: async () => { compensations++; throw new Error('Fixture connection lost after an ambiguous external outcome'); } });
  try {
    const completed = await inspectOperation(root, op.id);
    const unknown = await compensateOperation(root, op.id, completed.version, 'Explicit fixture compensation', config, true);
    assert.equal(unknown.phase, 'compensation_unknown'); assert.equal(compensations, 1);
    await assert.rejects(compensateOperation(root, op.id, unknown.version, 'Do not replay unknown compensation', config, true), /completed/);
    const query = await queryOperation(root, op.id, config);
    assert.equal(query.automaticResolution, false); assert.equal((await inspectOperation(root, op.id)).phase, 'compensation_unknown');
    const decisions = await Promise.allSettled(['first', 'second'].map(note => resolveOperation(root, op.id, unknown.version, 'not_applied', `Human fixture verification ${note}`)));
    assert.equal(decisions.filter(row => row.status === 'fulfilled').length, 1); assert.equal(compensations, 1);
  } finally { unregister(); }
  const next = await beginToolOperation({ ...ctx, operationId: 'different-provider-call' }, 'git_push', { remote: 'fixture-only' });
  assert.ok(next && next.id !== op.id); // Documented limitation, not business-level deduplication.
  config.hooks = Array.from({ length: 65 }, (_, index) => ({ event: 'FileChanged', matcher: `file-${index}.txt`, command: 'never-executed' }));
  assert.throws(() => startHookFileWatch(config, root), /64 explicit files/);

  const report = {
    timestamp: new Date().toISOString(), version: '0.61.0', reproductionCompleted: true,
    allAcceptanceChecksPassed: true,
    findings: [],
    fixedDefects:[{id:'V060-A1-01',originalId:'A1',path:'actual built Node CLI',directRecoverExitCode:direct.code,phase:directRecovery.phase,requests:directRecovery.requests,inventoryRefreshRequired:false,noAutomaticReplay:true}],
    passedBoundaries: ['stale Goal CAS rejected', '12 concurrent same-ID operation claims have one winner', 'ambiguous compensation is not replayed', 'inspection does not auto-resolve', 'manual reconciliation CAS has one winner', '65 literal watched files rejected'],
    confirmedLimitations: ['Different provider call IDs are not business-level deduplication'],
    externalProviderRequests: 0, osTasksRegistered: false, personalSettingsModified: false,
    qualification: 'Injected durable interrupted state plus an actually exited owned child; not a physical power-loss test. A2 connector is an in-process fixture; no Git push or external compensation.',
  };
  await writeJson(join(output, 'recovery-boundaries.json'), report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (oldHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = oldHome;
  await removeOwnedTemporaryFixture(root);
}
