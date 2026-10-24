import { expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnAgent, continueAgent } from '../src/agent.js';
import { loadSession } from '../src/sessions.js';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { parsePermissionRequest, grantPermissionOnce } from '../src/permissionApprovals.js';

test('permission pauses, deliberate end and plain questions persist complete tool-result boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-input-boundary-'));
  const previousHome = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'state');
  const requests: any[] = [];
  const call = (id: string, name: string, input: unknown) => ({ id, function: { name, arguments: JSON.stringify(input) } });
  const write = (id: string, path = 'approved.txt') => call(id, 'write_file', { path, content: 'approved' });
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(await request.json());
    const calls = requests.length === 1 ? [write('approval')]
      : requests.length === 2 ? [write('approved')]
      : requests.length === 3 ? [call('end', 'end_conversation', { reason: 'Finished.' }), write('skip', 'skipped.txt')]
      : requests.length === 4 ? [call('plain-question', 'ask_user', { question: 'What is the scope?' })] : undefined;
    return Response.json({ choices: [{ message: calls ? { content: null, tool_calls: calls } : { content: 'Plain answer accepted.' } }] });
  } });
  try {
    const config = structuredClone(defaultConfig);
    config.model.provider = 'compatible'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
    config.policy.workspaceRoots = [root]; config.policy.permissionRules.ask = ['write_file(*)'];
    config.agents.defaultIsolation = 'none'; config.hooks = []; config.pluginDirectories = []; config.agentsDirectories = []; config.skillsDirectories = [];
    await writeJson(join(root, '.ccpt', 'settings.json'), config);
    const paused = await spawnAgent({ goal: 'Write only with approval', cwd: root, config, background: false, isolation: 'none' });
    expect(paused.status).toBe('waiting_for_input'); expect(paused.pendingQuestionToolId).toBeUndefined();
    const request = parsePermissionRequest(paused.result)!;
    expect(request).toBeDefined(); expect(await readdir(root)).not.toContain('approved.txt');
    await grantPermissionOnce(request);
    const completed = await continueAgent(paused.id, 'Approved once; retry the exact write.', { config });
    expect(completed.status).toBe('completed'); expect(await readFile(join(root, 'approved.txt'), 'utf8')).toBe('approved');
    expect(await readdir(root)).not.toContain('skipped.txt');
    const session = await loadSession(completed.sessionId);
    const blocks = session.messages.flatMap((m) => Array.isArray(m.content) ? m.content : []);
    expect(blocks.filter((b) => b.type === 'tool_use').map((b) => b.id)).toEqual(blocks.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id));
    const question = await spawnAgent({ goal: 'Ask me the scope', cwd: root, config, background: false, isolation: 'none' });
    expect(question.pendingQuestionToolId).toBe('plain-question');
    expect((await continueAgent(question.id, 'Only the API', { config })).status).toBe('completed');
    expect(requests.at(-1).messages.find((m: any) => m.tool_call_id === 'plain-question').content).toBe('Only the API');
  } finally {
    server.stop(true);
    if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
    await rm(root, { recursive: true, force: true });
  }
}, 20_000); // Multiple real Agent continuations and filesystem/approval boundaries.
