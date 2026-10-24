// Exercise the distributable Node entrypoint, not the TypeScript worker entry.
// All settings, credentials and model traffic are isolated fixtures.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { createProjectPlan, loadProjectPlan } from '../src/plans.js';
import { cancelAgent, listAgents } from '../src/agent.js';
import { loadTask } from '../src/tasks.js';
import { writeJson } from '../src/storage.js';

const project = resolve(import.meta.dir, '..');
const root = await mkdtemp(join(tmpdir(), 'ccpt-packaged-plan-quality-'));
const previousHome = process.env.CCPT_HOME;
process.env.CCPT_HOME = join(root, 'home');
const requests: unknown[] = [];
const server = Bun.serve({ port: 0, async fetch(request) {
  requests.push(await request.json());
  return Response.json({ choices: [{ message: { content: 'Packaged Node worker verified quality evidence' }, finish_reason: 'stop' }] });
} });
const env = { ...process.env };
for (const name of Object.keys(env)) if (/^(CCPT_|ANTHROPIC_|OPENAI_|AZURE_OPENAI_)/.test(name)) delete env[name];
env.CCPT_HOME = process.env.CCPT_HOME;
const entry = join(project, 'dist', 'cli.js');
env.CCPT_CLI_ENTRY = entry;
async function cli(...args: string[]) {
  const child = Bun.spawn(['node', entry, ...args, '--cwd', root], { cwd: root, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timeout = setTimeout(() => child.kill(), 20000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exitCode !== 0) throw new Error(`Packaged CLI failed (${exitCode}): ${stderr.slice(0, 2000)}`);
    return JSON.parse(stdout);
  } finally { clearTimeout(timeout); }
}
try {
  const config = structuredClone(defaultConfig);
  config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/chat/completions`; config.model.apiKeyEnv = '';
  config.network.allowedHosts = ['127.0.0.1']; config.policy.workspaceRoots = [root];
  config.agents.defaultIsolation = 'none'; config.agents.maxTurns = 3;
  config.disableBundledSkills = true; config.marketplaceEnabled = false;
  config.hooks = [{ event: 'TaskCompleted', command: `node "${join(project, 'test', 'completion-gate-fixture.cjs')}" block-first` }];
  await writeJson(join(root, '.ccpt', 'settings.json'), config);
  const plan = await createProjectPlan({ cwd: root, request: 'Packaged Node smoke', content: '# Packaged Node quality validation' });
  const approved = await cli('plan', 'approve', plan.id);
  if (approved.status !== 'approved' || requests.length) throw new Error('Approval unexpectedly executed a model request');
  const agent = await cli('plan', 'execute', plan.id, '--foreground');
  const completed = await loadProjectPlan(root, plan.id);
  if (agent.status !== 'completed' || completed.status !== 'completed' || completed.executionAgentId !== agent.id) throw new Error('Completion ownership did not persist');
  if (!agent.taskId || (await loadTask(agent.taskId)).status !== 'completed') throw new Error('Linked task did not complete');
  if (requests.length !== 2 || !JSON.stringify(requests[1]).includes('Quality evidence missing')) throw new Error('Quality gate feedback did not reach the packaged worker');
  const recovered = await cli('plan', 'recover', plan.id);
  if (recovered.status !== 'completed' || requests.length !== 2) throw new Error('Recovery unexpectedly replayed work');
  const report = { pass: true, entrypoint: 'node dist/cli.js', modelRequests: requests.length, network: 'loopback fixture only', checks: ['approval does not infer', 'detached Node worker', 'exit-2 feedback', 'Agent/task/Plan completion', 'recovery does not replay'], credentialsUsed: false };
  await writeJson(join(project, '.ccpt', 'plan-teams-quality-final-20261016', 'packaged-cli-smoke.json'), report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const agent of await listAgents()) await cancelAgent(agent.id).catch(() => undefined);
  server.stop(true);
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture cleanup target');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
