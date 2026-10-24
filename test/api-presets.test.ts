import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig, loadConfig } from '../src/config.js';
import { API_PRESETS, apiPresetPatch, resolveModelEndpoint, resolveModelProtocol } from '../src/modelConnection.js';
import { callModel } from '../src/model.js';
import { writeJson } from '../src/storage.js';
import { navigateConfig, type ConfigDialogFacts, type ConfigDialogState } from '../src/components/commandDialogs.js';

test('Settings connection preset stages coherent protocol/auth defaults and clears the previous destination', () => {
  const config = structuredClone(defaultConfig); config.model.apiProtocol = 'messages'; config.model.endpointUrl = 'https://old.example/v1/messages';
  config.model.headersFromEnvironment = { authorization: 'OLD_SECRET' };
  const facts: ConfigDialogFacts = { cwd: '.', version: 'fixture', plugins: 0, skills: 0, agents: 0, activeAgents: 0, tasks: 0, sessionMessages: 0, estimatedTokens: 0 };
  const state: ConfigDialogState = { type: 'config', tab: 'Settings', query: 'API connection preset', selected: 0, scroll: 0, focus: 'rows' };
  navigateConfig(state, config, facts, 'space', ' ');
  expect(state.draft?.model).toMatchObject({ apiProtocol: 'chat-completions', apiKeyEnv: 'CCPT_API_KEY', apiKeyHeader: 'authorization', endpointUrl: '', baseUrl: '', headersFromEnvironment: {} });
  expect(config.model.endpointUrl).toBe('https://old.example/v1/messages');
  navigateConfig(state, config, facts, 'space', ' ');
  expect(state.draft?.model).toMatchObject({ apiProtocol: 'responses', apiKeyEnv: 'OPENAI_API_KEY', apiKeyHeader: 'authorization' });
  navigateConfig(state, config, facts, 'space', ' ');
  expect(state.draft?.model).toMatchObject({ apiProtocol: 'chat-completions', apiKeyEnv: 'AZURE_OPENAI_API_KEY', apiKeyHeader: 'api-key' });
  navigateConfig(state, config, facts, 'space', ' ');
  expect(state.draft?.model).toMatchObject({ apiProtocol: 'responses', apiKeyEnv: 'AZURE_OPENAI_API_KEY', apiKeyHeader: 'api-key' });
  navigateConfig(state, config, facts, 'space', ' ');
  expect(state.draft?.model).toMatchObject({ apiProtocol: 'messages', apiKeyEnv: 'CCPT_MESSAGES_API_KEY', apiKeyHeader: 'x-api-key' });
});

test('CA resolves from environment at reload, settings.env and network; explicit settings and managed policy win', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-ca-env-'));
  const names = ['CCPT_HOME', 'CCPT_CA_FILE', 'NODE_EXTRA_CA_CERTS', 'CCPT_MANAGED_CONFIG'] as const;
  const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name]; process.env.CCPT_HOME = join(root, 'state');
  try {
    process.env.NODE_EXTRA_CA_CERTS = join(root, 'fallback.pem'); expect((await loadConfig(root)).network.caFile).toBe(process.env.NODE_EXTRA_CA_CERTS);
    process.env.CCPT_CA_FILE = join(root, 'explicit.per'); expect((await loadConfig(root)).network.caFile).toBe(process.env.CCPT_CA_FILE);
    await writeJson(join(root, '.ccpt', 'settings.json'), { env: { CCPT_CA_FILE: join(root, 'settings-env.pem') } });
    expect((await loadConfig(root)).network.caFile).toBe(process.env.CCPT_CA_FILE);
    delete process.env.CCPT_CA_FILE; expect((await loadConfig(root)).network.caFile).toBe(join(root, 'settings-env.pem'));
    await writeJson(join(root, '.ccpt', 'settings.json'), { network: { caFile: 'project.per' } });
    expect((await loadConfig(root)).network.caFile).toBe(join(root, 'project.per'));
    process.env.CCPT_MANAGED_CONFIG = join(root, 'managed.json'); await writeJson(process.env.CCPT_MANAGED_CONFIG, { network: { caFile: 'managed.pem' } });
    expect((await loadConfig(root)).network.caFile).toBe(join(root, 'managed.pem'));
    await writeJson(process.env.CCPT_MANAGED_CONFIG, { network: { caFile: '' } }); expect((await loadConfig(root)).network.caFile).toBe('');
  } finally { for (const name of names) { if (prior[name] === undefined) delete process.env[name]; else process.env[name] = prior[name]; } await rm(root, { recursive: true, force: true }); }
});

test('preset routes URLs, headers, tool request and response formats for both APIs with no cross-provider credentials', async () => {
  const previousAzure = process.env.AZURE_OPENAI_API_KEY, previousMessages = process.env.CCPT_MESSAGES_API_KEY;
  process.env.AZURE_OPENAI_API_KEY = 'azure-fixture'; process.env.CCPT_MESSAGES_API_KEY = 'messages-fixture';
  const received: { url: string; headers: Headers; body: any }[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any; received.push({ url: request.url, headers: request.headers, body });
    if (request.url.includes('/messages')) return Response.json({ content: [{ type: 'tool_use', id: 'messages-call', name: 'read_file', input: { path: 'README.md' } }], stop_reason: 'tool_use', usage: { input_tokens: 19, output_tokens: 3 } });
    return Response.json({ choices: [{ message: { tool_calls: [{ id: 'azure-call', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 19, completion_tokens: 3 } });
  } });
  try {
    for (const preset of ['azure-openai', 'messages'] as const) {
      const config = structuredClone(defaultConfig);
      config.model = { ...config.model, ...apiPresetPatch(preset), endpointUrl: `http://127.0.0.1:${server.port}/${preset === 'messages' ? 'v1/messages' : 'openai/v1/chat/completions?api-version=v1'}`, name: 'deployment' };
      config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
      const response = await callModel(config, 'system-fixture', [{ role: 'user', content: 'Read file' }], [{ name: 'read_file', description: 'Read', input_schema: { type: 'object' } }]);
      expect(response.content.find((block) => block.type === 'tool_use')).toMatchObject({ type: 'tool_use', name: 'read_file', input: { path: 'README.md' } }); expect(response.usage?.inputTokens).toBe(19);
      const { headers, body } = received.at(-1)!;
      expect(headers.get('authorization')).toBeNull();
      if (preset === 'azure-openai') {
        expect(headers.get('api-key')).toBe('azure-fixture'); expect(headers.has('x-api-key')).toBe(false);
        expect(body.tools[0].function.name).toBe('read_file'); expect(body.messages[0]).toEqual({ role: 'system', content: 'system-fixture' }); expect(body.max_completion_tokens).toBeDefined();
      } else {
        expect(headers.get('x-api-key')).toBe('messages-fixture'); expect(headers.has('api-key')).toBe(false);
        expect(body.tools[0].name).toBe('read_file'); expect(body.system).toBe('system-fixture'); expect(body.max_tokens).toBeDefined(); expect(body.max_completion_tokens).toBeUndefined();
      }
    }
  } finally { server.stop(true); if (previousAzure === undefined) delete process.env.AZURE_OPENAI_API_KEY; else process.env.AZURE_OPENAI_API_KEY = previousAzure; if (previousMessages === undefined) delete process.env.CCPT_MESSAGES_API_KEY; else process.env.CCPT_MESSAGES_API_KEY = previousMessages; }
});

test('CLI preset persists the selected request/response mode and refuses destination-free switching', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-cli-preset-'));
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../src/cli.ts'), 'config', 'set', ...args], { cwd: root, env: { ...process.env, CCPT_HOME: join(root, 'state') }, stdout: 'pipe', stderr: 'pipe' });
    return { code: await child.exited, out: await new Response(child.stdout).text(), err: await new Response(child.stderr).text() };
  };
  try {
    for (const preset of API_PRESETS) {
      const protocol = apiPresetPatch(preset).apiProtocol!;
      const result = await run(['--api-preset', preset, '--endpoint-url', `https://company.example/v1/${protocol === 'chat-completions' ? 'chat/completions' : protocol}`]);
      expect(result.code, result.err).toBe(0);
      const saved = JSON.parse(await readFile(join(root, '.ccpt', 'settings.json'), 'utf8'));
      expect(saved.model.apiProtocol).toBe(protocol);
    }
    expect((await run(['--api-preset', 'azure-openai'])).code).not.toBe(0);
    expect((await run(['--api-preset', 'azure-openai', '--api-protocol', 'messages', '--base-url', 'https://company.example/v1'])).code).not.toBe(0);
    const company = await run(['--global', '--api-preset', 'azure-responses', '--endpoint-url', 'https://company.example/responses/v1/responses', '--model', 'gpt-6-luna', '--api-key-env', 'AZURE_OPENAI_API_KEY', '--api-key-header', 'api-key', '--marketplace', 'disabled']);
    expect(company.code, company.err).toBe(0);
    const globalSettings = JSON.parse(await readFile(join(root, 'state', 'settings.json'), 'utf8'));
    expect(globalSettings.model).toMatchObject({ name: 'gpt-6-luna', apiProtocol: 'responses', endpointUrl: 'https://company.example/responses/v1/responses', apiKeyEnv: 'AZURE_OPENAI_API_KEY', apiKeyHeader: 'api-key' });
    expect(globalSettings.marketplaceEnabled).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);

test('explicit protocol overrides legacy provider and known endpoint mismatches fail safely', () => {
  for (const apiProtocol of ['messages', 'responses', 'chat-completions'] as const) {
    const model = { ...defaultConfig.model, provider: 'anthropic' as const, apiProtocol, baseUrl: 'https://gateway.example/v1?api-version=preview' };
    expect(resolveModelProtocol(model)).toBe(apiProtocol);
    expect(resolveModelEndpoint(model)).toBe(`https://gateway.example/v1/${apiProtocol === 'chat-completions' ? 'chat/completions' : apiProtocol}?api-version=preview`);
    for (const field of ['baseUrl', 'endpointUrl'] as const) {
      expect(() => resolveModelEndpoint({ ...model, [field]: `https://gateway.example/v1/${apiProtocol === 'messages' ? 'responses' : 'messages'}` })).toThrow('no automatic route switch');
    }
  }
  expect(() => resolveModelEndpoint({ ...defaultConfig.model, endpointUrl: 'not-a-url-secret' })).toThrow('valid absolute HTTP(S) URL');
});
