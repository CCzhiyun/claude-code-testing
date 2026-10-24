import { expect, test } from 'bun:test';
import { defaultConfig, validateConfig, normalizeClaudeCompatibleSettings } from '../src/config.js';
import { callModel } from '../src/model.js';
import { resolveModelEndpoint, resolveModelProtocol, resolveModelWireProtocol } from '../src/modelConnection.js';
import { responsesRequest } from '../src/responsesModel.js';
import { migrateGlmResponsesSettings } from '../src/responsesSettingsMigration.js';
import type { ModelMessage } from '../src/types.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnAgent, waitForAgent } from '../src/agent.js';
import { writeJson } from '../src/storage.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

function config(url: string) {
  const c = structuredClone(defaultConfig); c.model.endpointUrl = url;
  c.network = { proxyUrl: '', allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 3000 };
  c.modelRetry = { maxRetries: 0 }; return c;
}
const output = [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'CCPT_OK', annotations: [] }] }];

test('new default sends native Responses, returns the standard object, and does not inherit Messages auth', async () => {
  let received: any, headers: Headers;
  const server = Bun.serve({ port: 0, async fetch(req) { received = await req.json(); headers = req.headers;
    return Response.json({ id: 'resp_native', object: 'response', status: 'completed', output, usage: { input_tokens: 20, output_tokens: 3 } }); } });
  try {
    const c = config(`http://127.0.0.1:${server.port}/v1/responses`);
    expect(c.model.provider).toBe('openai'); expect(resolveModelProtocol(c.model)).toBe('responses');
    const result = await callModel(c, 'Rules', [{ role: 'user', content: 'Hello' }], []);
    expect(received).toMatchObject({ input: [{ role: 'user', content: 'Hello' }], instructions: 'Rules', store: false });
    for (const field of ['messages', 'system', 'max_tokens', 'reasoning_effort']) expect(received[field]).toBeUndefined();
    expect(headers!.has('anthropic-version')).toBe(false);
    expect(result.response).toMatchObject({ id: 'resp_native', object: 'response', status: 'completed', output });
    expect(result.content).toEqual([{ type: 'text', text: 'CCPT_OK' }]);
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 3 });
  } finally { server.stop(true); }
});

test('Responses replay retains native encrypted reasoning only for matching unmodified history', async () => {
  const reasoning = { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque-preserve-exactly', summary: [] };
  const server = Bun.serve({ port: 0, fetch() { return Response.json({ id: 'resp_reasoning', status: 'completed', output: [reasoning, ...output] }); } });
  try {
    const c = config(`http://127.0.0.1:${server.port}/responses`);
    const history: ModelMessage[] = [{ role: 'user', content: 'Original' }];
    const response = await callModel(c, 'Rules', history, []);
    history.push({ role: 'assistant', content: response.content, ...(response.responses ? { responses: response.responses } : {}) });
    history.push({ role: 'user', content: 'Continue' });
    expect(responsesRequest(c, 'Rules', history, [], false).body.input).toContainEqual(reasoning);
    history[0]!.content = 'Edited';
    expect(JSON.stringify(responsesRequest(c, 'Rules', history, [], false).body.input)).not.toContain('opaque-preserve-exactly');
    c.model.responsesTransport = 'chat-completions'; c.model.endpointUrl = `http://127.0.0.1:${server.port}/chat/completions`;
    expect(JSON.stringify(responsesRequest(c, 'Rules', history, [], false).body.input)).not.toContain('opaque-preserve-exactly');
  } finally { server.stop(true); }
});

test('explicit Chat bridge translates canonical tool/result history and returns a marked Responses object', async () => {
  const received: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(req) { received.push(await req.json());
    return Response.json({ choices: [{ message: received.length === 1
      ? { reasoning_content: 'Use echo', tool_calls: [{ id: 'call_echo', type: 'function', function: { name: 'echo', arguments: '{"value":"CCPT_OK"}' } }] }
      : { content: 'CCPT_OK' }, finish_reason: received.length === 1 ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 5 } } }); } });
  try {
    const c = config(`http://127.0.0.1:${server.port}/chat/completions`); c.model.responsesTransport = 'chat-completions';
    const history: ModelMessage[] = [{ role: 'user', content: 'Use echo' }];
    const tools = [{ name: 'echo', description: 'Echo', input_schema: { type: 'object', properties: { value: { type: 'string' } } } }];
    const first = await callModel(c, 'Rules', history, tools);
    expect(first.response).toMatchObject({ object: 'response', status: 'completed', metadata: { ccpt_transport: 'chat-completions' }, usage: { input_tokens: 20, output_tokens: 3, total_tokens: 23 } });
    expect(first.response!.output).toContainEqual({ type: 'function_call', call_id: 'call_echo', name: 'echo', arguments: '{"value":"CCPT_OK"}', status: 'completed' });
    history.push({ role: 'assistant', content: first.content, ...(first.responses ? { responses: first.responses } : {}) }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_echo', content: 'CCPT_OK' }] });
    const second = await callModel(c, 'Rules', history, tools);
    expect(second.response!.output).toEqual(output);
    expect(received[1].messages).toContainEqual({ role: 'tool', tool_call_id: 'call_echo', content: 'CCPT_OK' });
    expect(received[1].messages.find((m: any) => m.role === 'assistant').reasoning_content).toBe('Use echo');
    expect(resolveModelProtocol(c.model)).toBe('responses'); expect(resolveModelWireProtocol(c.model)).toBe('chat-completions');
    expect(second.usage).toEqual({ inputTokens: 20, outputTokens: 3, cacheReadTokens: 5 });
  } finally { server.stop(true); }
});

test('native failure never silently switches protocol, and bridge cannot emulate server-side features', async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, fetch() { calls++; return Response.json({ error: { message: 'Route not found', code: 'not_found' } }, { status: 404 }); } });
  try {
    const c = config(`http://127.0.0.1:${server.port}/responses`);
    await expect(callModel(c, '', [], [])).rejects.toThrow('Route not found'); expect(calls).toBe(1);
    c.model.responsesTransport = 'chat-completions';
    expect(() => resolveModelEndpoint(c.model)).toThrow('route');
    c.model.endpointUrl = `http://127.0.0.1:${server.port}/chat/completions`; c.model.responsesStore = true;
    expect(() => validateConfig(c)).toThrow('responsesStore');
    await expect(callModel(c, '', [], [])).rejects.toThrow('does not emulate'); expect(calls).toBe(1);
  } finally { server.stop(true); }
});

test('GLM migration preserves deployment and CA, remaps credentials without mutation, and refuses other destinations', () => {
  const original = { env: { ANTHROPIC_AUTH_TOKEN: 'fixture-only', ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic', API_TIMEOUT_MS: '120000' },
    model: { provider: 'anthropic', name: 'glm-5.3-flash' }, network: { caFile: 'company.pem' }, marketplaceEnabled: false };
  const saved = JSON.stringify(original), result: any = migrateGlmResponsesSettings(original);
  expect(result.model).toMatchObject({ provider: 'openai', apiProtocol: 'responses', responsesTransport: 'chat-completions', name: 'glm-5.3-flash', apiKeyEnv: 'OPENAI_API_KEY' });
  expect(result.env).toEqual({ OPENAI_API_KEY: 'fixture-only' }); expect(result.network).toEqual({ caFile: 'company.pem', timeoutMs: 120000 });
  expect(result.marketplaceEnabled).toBe(false); expect(JSON.stringify(original)).toBe(saved);
  expect(migrateGlmResponsesSettings(result)).toEqual(result);
  expect(() => migrateGlmResponsesSettings({ model: { name: 'glm-5.3-flash', baseUrl: 'https://other.example/api' } })).toThrow('destination');
  expect(() => migrateGlmResponsesSettings({ ...original, env: { ...original.env, OPENAI_API_KEY: 'other-fixture' } })).toThrow('Conflicting');
  expect(normalizeClaudeCompatibleSettings({ env: { OPENAI_MODEL: 'glm-5.3-flash', OPENAI_BASE_URL: 'https://model.example/v1' } }).model).toMatchObject({ provider: 'openai', apiProtocol: 'responses', name: 'glm-5.3-flash', apiKeyEnv: 'OPENAI_API_KEY' });
});

for (const transport of ['native', 'chat-completions'] as const) test(`detached Responses worker inherits the default OPENAI_API_KEY (${transport})`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-responses-worker-'));
  const prior = { home: process.env.CCPT_HOME, key: process.env.OPENAI_API_KEY, entry: process.env.CCPT_CLI_ENTRY };
  process.env.CCPT_HOME = join(root, 'state'); process.env.OPENAI_API_KEY = 'responses-worker-fixture';
  process.env.CCPT_CLI_ENTRY = resolve(import.meta.dir, '../src/cli.ts');
  let authorization = '', body: any;
  let ownedWorkerPid: number | undefined;
  const server = Bun.serve({ port: 0, async fetch(req) { authorization = req.headers.get('authorization') || ''; body = await req.json();
    return Response.json(transport === 'native' ? { id: 'resp_worker', object: 'response', status: 'completed', output }
      : { choices: [{ message: { content: 'CCPT_OK' }, finish_reason: 'stop' }] }); } });
  try {
    const c = config(`http://127.0.0.1:${server.port}/${transport === 'native' ? 'responses' : 'chat/completions'}`);
    c.model.responsesTransport = transport; c.policy.workspaceRoots = [root]; c.marketplaceEnabled = false;
    await writeJson(join(root, '.ccpt', 'settings.json'), c);
    const started = await spawnAgent({ cwd: root, config: c, goal: 'Reply CCPT_OK only.', background: true, isolation: 'none', allowedTools: [] });
    const finished = await waitForAgent(started.id, 10000);
    ownedWorkerPid = finished.pid;
    expect(finished.status, finished.error).toBe('completed'); expect(finished.result).toBe('CCPT_OK');
    expect(authorization).toBe('Bearer responses-worker-fixture');
    expect(body[transport === 'native' ? 'input' : 'messages']).toBeArray();
    expect(body[transport === 'native' ? 'messages' : 'input']).toBeUndefined();
  } finally {
    // A durable terminal result is not a process-exit notification: final Hooks,
    // audit and metadata flush can still own the worker cwd on Windows. Wait for
    // this fixture's observed worker only; never kill a PID from persisted data.
    if (ownedWorkerPid) {
      const deadline = Date.now() + 3000;
      while (true) {
        try { process.kill(ownedWorkerPid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') break; throw error; }
        if (Date.now() >= deadline) throw new Error('Owned fixture worker did not exit after its terminal result');
        await Bun.sleep(25);
      }
    }
    server.stop(true);
    for (const [name, value] of [['CCPT_HOME', prior.home], ['OPENAI_API_KEY', prior.key], ['CCPT_CLI_ENTRY', prior.entry]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    // Bun/Windows does not consistently honor fs.rm maxRetries for cwd EBUSY.
    await removeOwnedTemporaryFixture(root);
  }
}, 15000);
