import { test, expect } from 'bun:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { probeModel, modelProbeOverrides } from '../src/modelProbe.js';
import { apiPresetPatch } from '../src/modelConnection.js';
import { writeJson } from '../src/storage.js';

test('probe destination changes require explicit credential selection, including settings files', () => {
  expect(() => modelProbeOverrides(['--endpoint-url', 'https://other.example/responses'])).toThrow('credentials are not inferred');
  expect(() => modelProbeOverrides([], { endpointUrl: 'https://other.example/responses' })).toThrow('credentials are not inferred');
  const patch = modelProbeOverrides(['--api-preset', 'azure-responses', '--endpoint-url', 'https://company.example/responses', '--model', 'gpt-5.6-luna']);
  expect(patch.model).toMatchObject({ apiProtocol: 'responses', apiKeyEnv: 'AZURE_OPENAI_API_KEY', name: 'gpt-5.6-luna', headersFromEnvironment: {} });
});

test('connectivity-only is unauthenticated and never claims model support', async () => {
  const received: Request[] = [];
  const server = Bun.serve({ port: 0, fetch(request) { received.push(request); return new Response(null, { status: 401 }); } });
  const config = structuredClone(defaultConfig); config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses?secret=HIDDEN`;
  config.model.apiProtocol = 'responses';
  config.model.apiKeyEnv = 'CCPT_PROBE_ABSENT'; config.network.proxyUrl = '';
  try {
    const report = await probeModel(config, { connectivityOnly: true });
    expect(report).toMatchObject({ ok: true, stage: 'http-reachable', status: 401, authenticatedModelVerified: false });
    expect(received[0]?.method).toBe('HEAD'); expect([...received[0]!.headers.keys()].some((k) => ['authorization', 'api-key', 'x-api-key'].includes(k))).toBe(false);
    expect(JSON.stringify(report)).not.toContain('HIDDEN');
    expect(await probeModel(config)).toMatchObject({ ok: false, stage: 'credentials' }); expect(received).toHaveLength(1);
    config.network.rejectUnauthorized = false;
    expect((await probeModel(config, { connectivityOnly: true })).ok).toBe(false); expect(received).toHaveLength(1);
  } finally { server.stop(true); }
});

test('Responses probe checks echo tool round trip without repository context or arbitrary tools', async () => {
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(await request.json());
    return Response.json({ id: `resp_${requests.length}`, status: 'completed', output: requests.length === 1 ? [{ type: 'function_call', name: 'ccpt_probe_echo', call_id: 'call_echo', arguments: '{"value":"CCPT_OK"}' }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'CCPT_OK' }] }], usage: { input_tokens: 40, output_tokens: 5 } });
  } });
  const config = structuredClone(defaultConfig); config.model.apiProtocol = 'responses'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`; config.network.proxyUrl = '';
  try {
    const report = await probeModel(config, { stream: true, toolsCheck: true });
    expect(report).toMatchObject({ ok: true, toolRoundTrip: true, expectedReplyMatched: true }); expect(requests).toHaveLength(2);
    expect(requests[0].tools.map((tool: any) => tool.name)).toEqual(['ccpt_probe_echo']); expect(requests[0].store).toBe(false);
    expect(requests[1].input).toContainEqual({ type: 'function_call_output', call_id: 'call_echo', output: 'CCPT_OK' });
    expect(config.model.maxOutputTokens).toBe(defaultConfig.model.maxOutputTokens);
  } finally { server.stop(true); }
});

test('probe reports HTTP failures without raw errors or credential echoes; stops at deadline', async () => {
  let status = 404, calls = 0;
  const server = Bun.serve({ port: 0, async fetch() { calls++; if (status === 200) await Bun.sleep(500); return Response.json({ error: { message: 'secret-test-do-not-display' } }, { status }); } });
  const config = structuredClone(defaultConfig); config.model.apiProtocol = 'responses'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`; config.network.proxyUrl = '';
  try {
    for (const [code, stage] of [[404, 'route-or-deployment'], [401, 'authentication'], [429, 'capacity']] as const) {
      status = code; const report = await probeModel(config); expect(report).toMatchObject({ ok: false, stage, status: code }); expect(JSON.stringify(report)).not.toContain('secret-test');
    }
    expect(calls).toBe(3); status = 200;
    expect(await probeModel(config, { timeoutMs: 100 })).toMatchObject({ ok: false, stage: 'timeout' });
  } finally { server.stop(true); }
});

test('CLI probe skips plugins/hooks, preserves settings, and honors managed deployment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-probe-cli-')); const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) { requests.push(await request.json()); return Response.json({ id: 'resp_test', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'CCPT_OK' }] }] }); } });
  const settings = { model: { ...apiPresetPatch('azure-responses'), endpointUrl: `http://127.0.0.1:${server.port}/responses`, name: 'test-deployment' }, marketplaceEnabled: false };
  const file = join(root, 'probe.json'); await writeJson(file, settings);
  await mkdir(join(root, '.ccpt'), { recursive: true });
  await writeJson(join(root, '.ccpt', 'settings.json'), { hooks: [{ event: 'SessionStart', command: 'SHOULD_NEVER_EXECUTE' }] });
  await writeFile(join(root, 'CLAUDE.md'), 'REPOSITORY_SECRET_MUST_NOT_BE_SENT');
  const managed = join(root, 'managed.json'); await writeJson(managed, { model: { name: 'managed-deployment' } });
  try {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../src/cli.ts'), 'model', 'test', '--settings', file, '--model', 'requested-deployment'], { cwd: root, env: { ...process.env, CCPT_HOME: join(root, 'state'), CCPT_MANAGED_CONFIG: managed, AZURE_OPENAI_API_KEY: 'probe-key-fixture' }, stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, err + out).toBe(0); expect(JSON.parse(out).model).toBe('managed-deployment');
    expect(requests[0].model).toBe('managed-deployment'); expect(JSON.stringify(requests)).not.toContain('REPOSITORY_SECRET');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(settings);
  } finally { server.stop(true); await rm(root, { recursive: true, force: true, maxRetries: 3 }); }
}, 15000);
