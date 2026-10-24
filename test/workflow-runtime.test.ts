import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { cancelAgent, listAgents } from '../src/agent.js';
import { runWorkflow } from '../src/workflow.js';
import { writeJson } from '../src/storage.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-workflow-runtime-'));
  const oldHome = process.env.CCPT_HOME, oldEntry = process.env.CCPT_CLI_ENTRY;
  process.env.CCPT_HOME = join(root, 'state'); process.env.CCPT_CLI_ENTRY = join(import.meta.dir, '../src/cli.ts');
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json(); requests.push(body); await Bun.sleep(25);
    return Response.json({ choices: [{ message: { content: 'Workflow validation complete' }, finish_reason: 'stop' }] });
  } });
  const config = structuredClone(defaultConfig); config.marketplaceEnabled = false; config.hooks = []; config.disableBundledSkills = true;
  config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/chat/completions`; config.model.apiKeyEnv = '';
  config.agents.defaultIsolation = 'none'; config.agents.maxConcurrent = 2; config.policy.workspaceRoots = [root]; config.network.allowedHosts = ['127.0.0.1'];
  await writeJson(join(root, '.ccpt', 'settings.json'), config);
  return { root, config, requests, async close() {
    for (const agent of await listAgents()) await cancelAgent(agent.id).catch(() => undefined);
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && (await listAgents()).some(agent => ['queued', 'working'].includes(agent.status))) await Bun.sleep(25);
    await Bun.sleep(150); server.stop(true);
    if (oldHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = oldHome;
    if (oldEntry === undefined) delete process.env.CCPT_CLI_ENTRY; else process.env.CCPT_CLI_ENTRY = oldEntry;
    await removeOwnedTemporaryFixture(root);
  } };
}

test('workflow launches independent workers then starts a dependent task after success', async () => {
  const f = await fixture();
  try {
    const results = await runWorkflow({ name: 'Dependency fixture', tasks: [
      { id: 'implementation', goal: 'Inspect implementation fixture' }, { id: 'tests', goal: 'Inspect testing fixture' },
      { id: 'review', goal: 'Review dependency outcomes', dependsOn: ['implementation', 'tests'] },
    ] }, f.root, f.config);
    expect([...results.keys()]).toEqual(['implementation', 'tests', 'review']);
    expect([...results.values()].every(agent => agent.status === 'completed')).toBe(true); expect(f.requests).toHaveLength(3);
    expect(f.requests[2].messages[0].content).toContain('Goal: Review dependency outcomes');
  } finally { await f.close(); }
}, 20000);

test('partial workflow launch failure does not leave its other workers running', async () => {
  const f = await fixture();
  try {
    await expect(runWorkflow({ name: 'Partial launch', tasks: [
      { id: 'started', goal: 'Inspect a bounded fixture', isolation: 'none' },
      { id: 'cannot-start', goal: 'Request worktree in a non-Git directory', isolation: 'worktree' },
    ] }, f.root, f.config)).rejects.toThrow('Workflow launch failed');
    const agents = await listAgents(); expect(agents).toHaveLength(2);
    expect(agents.every(agent => !['queued', 'working'].includes(agent.status))).toBe(true);
  } finally { await f.close(); }
}, 20000);
