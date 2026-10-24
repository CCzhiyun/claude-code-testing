import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import tls from 'node:tls';
import { modelCredentialNames, sanitizedEnvironment } from '../src/environment.js';
import { defaultConfig, loadConfig } from './legacyFixtureConfig.js';
import { writeJson } from '../src/storage.js';
import { resolveModelEndpoint } from '../src/modelConnection.js';
import { callModel } from '../src/model.js';
import { networkJson, readCaCertificates } from '../src/network.js';
import { addMarketplace, autoUpdateMarketplaces, ensureOfficialMarketplace, installMarketplacePlugin, refreshMarketplace, updateMarketplacePlugin } from '../src/marketplace.js';
import { spawnAgent, waitForAgent } from '../src/agent.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
import { configDialogRows, navigateConfig, type ConfigDialogFacts, type ConfigDialogState } from '../src/components/commandDialogs.js';

test('endpoint resolution supports base, complete Azure v1/deployment URLs, queries, and both protocols without duplicate suffixes', () => {
  const model = defaultConfig.model;
  for (const baseUrl of ['https://company.example/v1', 'https://company.example/v1/chat/completions', 'https://company.example/v1/chat/completions/']) {
    expect(resolveModelEndpoint({ ...model, baseUrl })).toBe('https://company.example/v1/chat/completions');
  }
  expect(resolveModelEndpoint({ ...model, baseUrl: 'https://resource.openai.azure.com/openai/v1/' })).toBe('https://resource.openai.azure.com/openai/v1/chat/completions');
  expect(resolveModelEndpoint({ ...model, baseUrl: 'https://company.example/openai/deployments/demo/chat/completions?api-version=2024-10-21' })).toBe('https://company.example/openai/deployments/demo/chat/completions?api-version=2024-10-21');
  for (const baseUrl of ['https://company.example', 'https://company.example/v1', 'https://company.example/v1/messages']) {
    expect(resolveModelEndpoint({ ...model, apiProtocol: 'messages', baseUrl })).toBe('https://company.example/v1/messages');
  }
  expect(() => resolveModelEndpoint({ ...model, endpointUrl: 'https://user:secret@company.example/v1' })).toThrow('embedded credentials');
});

test('custom credential variable names are stripped from tool environments even without KEY/TOKEN in their names', () => {
  const prior = process.env.CCPT_FIXTURE_VALUE;
  process.env.CCPT_FIXTURE_VALUE = 'private-fixture';
  try {
    const config = structuredClone(defaultConfig); config.model.apiKeyEnv = 'CCPT_FIXTURE_VALUE';
    expect(sanitizedEnvironment('normal', {}, [], modelCredentialNames(config)).CCPT_FIXTURE_VALUE).toBeUndefined();
    expect(sanitizedEnvironment('sandbox', {}, ['CCPT_FIXTURE_VALUE'], modelCredentialNames(config)).CCPT_FIXTURE_VALUE).toBeUndefined();
  } finally { if (prior === undefined) delete process.env.CCPT_FIXTURE_VALUE; else process.env.CCPT_FIXTURE_VALUE = prior; }
});

test('Settings stages Marketplace, CA paths and API fields; cancelling text edits preserves the draft', () => {
  const config = structuredClone(defaultConfig);
  const facts: ConfigDialogFacts = { cwd: '.', version: 'fixture', plugins: 0, skills: 0, agents: 0, activeAgents: 0, tasks: 0, sessionMessages: 0, estimatedTokens: 0 };
  const state: ConfigDialogState = { type: 'config', tab: 'Settings', query: 'Marketplace', selected: 0, scroll: 0, focus: 'rows' };
  navigateConfig(state, config, facts, 'space', ' ');
  expect(state.pending?.marketplaceEnabled).toBe(false); expect(config.marketplaceEnabled).toBe(true);
  state.query = 'Custom CA'; navigateConfig(state, config, facts, 'space', ' ');
  navigateConfig(state, config, facts, '', 'C:\\Corporate Certs\\ca.per'); navigateConfig(state, config, facts, 'return');
  expect(state.pending?.network).toEqual({ caFile: 'C:\\Corporate Certs\\ca.per' });
  navigateConfig(state, config, facts, 'space', ' '); navigateConfig(state, config, facts, 'u'); navigateConfig(state, config, facts, '', 'discarded'); navigateConfig(state, config, facts, 'escape');
  expect(state.pending?.network).toEqual({ caFile: 'C:\\Corporate Certs\\ca.per' });
  expect(configDialogRows(config, 'Settings', facts).map((row) => row.id)).toEqual(expect.arrayContaining(['apiProtocol', 'apiAuth', 'apiKeyEnv', 'endpoint', 'tokenField']));
});

test('disabled Marketplace blocks seeding, adding, install and update without deleting local plugin files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-marketplace-off-')); const previous = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'state');
  try {
    await writeJson(join(root, '.ccpt', 'settings.json'), { marketplaceEnabled: false });
    await writeFile(join(root, 'local-plugin-marker'), 'keep');
    for (const action of [() => ensureOfficialMarketplace(root), () => addMarketplace(root, 'invalid/repo'), () => refreshMarketplace(root), () => installMarketplacePlugin(root, 'missing'), () => updateMarketplacePlugin(root, 'missing')]) await expect(action()).rejects.toThrow('Marketplace is disabled');
    expect(await autoUpdateMarketplaces(root)).toEqual({ refreshed: [], updated: [], errors: [] });
    expect(await readFile(join(root, 'local-plugin-marker'), 'utf8')).toBe('keep');
    expect((await loadConfig(root)).marketplaceEnabled).toBe(false);
  } finally { if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await rm(root, { recursive: true, force: true }); }
});

test('CLI global enterprise settings persist in user scope, preserve model on network-only edits and keep credentials out of JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-global-config-')); const state = join(root, 'state');
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../src/cli.ts'), 'config', 'set', '--global', ...args], { cwd: root, env: { ...process.env, CCPT_HOME: state }, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(code, stderr || stdout).toBe(0);
  };
  try {
    await writeJson(join(state, 'settings.json'), { model: { name: 'retain-this-model' } });
    await run(['--marketplace', 'disabled']);
    let saved = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
    expect(saved.model).toEqual({ name: 'retain-this-model' }); expect(saved.marketplaceEnabled).toBe(false);
    await run(['--api-protocol', 'chat-completions', '--endpoint-url', 'https://company.example/v1/chat/completions', '--api-key-env', 'AZURE_OPENAI_API_KEY', '--api-key-header', 'api-key', '--token-field', 'max_completion_tokens', '--model', 'company-deployment']);
    saved = JSON.parse(await readFile(join(state, 'settings.json'), 'utf8'));
    expect(saved.model.apiKeyPrefix).toBe(''); expect(saved.model.apiProtocol).toBe('chat-completions'); expect(saved.model.name).toBe('company-deployment');
    const ca = join(root, 'company ca.per'); await writeFile(ca, tls.rootCertificates[0]!);
    await run(['--ca-file', ca]);
    expect(JSON.parse(await readFile(join(state, 'settings.json'), 'utf8')).network.caFile).toBe(ca);
    await run(['--clear-ca']);
    expect(JSON.parse(await readFile(join(state, 'settings.json'), 'utf8')).network.caFile).toBe('');
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30000);

test('both APIs send explicit key headers and configured token limits on JSON and SSE paths; background workers retain Azure credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-api-protocols-'));
  const prior = { home: process.env.CCPT_HOME, key: process.env.CCPT_TEST_AZURE_KEY, entry: process.env.CCPT_CLI_ENTRY };
  process.env.CCPT_HOME = join(root, 'state'); process.env.CCPT_TEST_AZURE_KEY = 'fixture-only-key'; process.env.CCPT_CLI_ENTRY = resolve(import.meta.dir, '../src/cli.ts');
  const requests: { url: URL; body: any; headers: Headers }[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any; const url = new URL(request.url); requests.push({ url, body, headers: request.headers });
    if (url.pathname.endsWith('/messages')) return Response.json({ content: [{ type: 'text', text: 'Messages OK' }], usage: { input_tokens: 12, output_tokens: 4 } });
    if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"Chat OK"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    return Response.json({ choices: [{ message: { content: 'Chat OK' } }], usage: { prompt_tokens: 12, completion_tokens: 4 } });
  } });
  try {
    const config = structuredClone(defaultConfig);
    config.model = { ...config.model, apiProtocol: 'chat-completions', name: 'company-deployment', baseUrl: `http://127.0.0.1:${server.port}/openai/v1/chat/completions?api-version=v1`, apiKeyEnv: 'CCPT_TEST_AZURE_KEY', apiKeyHeader: 'api-key', apiKeyPrefix: '', completionTokenField: 'max_completion_tokens' };
    config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
    config.policy.workspaceRoots = [root]; config.hooks = []; config.marketplaceEnabled = false;
    for (const stream of [undefined, {}]) {
      expect((await callModel(config, 'Test', [{ role: 'user', content: 'Hello' }], [], stream)).usage?.inputTokens).toBe(12);
      const request = requests.at(-1)!;
      expect(request.url.pathname).toBe('/openai/v1/chat/completions'); expect(request.url.searchParams.get('api-version')).toBe('v1');
      expect(request.headers.get('api-key')).toBe('fixture-only-key'); expect(request.headers.has('authorization')).toBe(false);
      expect(request.body.max_completion_tokens).toBe(config.model.maxOutputTokens); expect(request.body.max_tokens).toBeUndefined();
    }
    await writeJson(join(root, '.ccpt', 'settings.json'), config);
    const started = await spawnAgent({ goal: 'Hello 你好', cwd: root, config, isolation: 'none', background: true });
    expect((await waitForAgent(started.id, 10000)).status).toBe('completed');
    expect(requests.at(-1)!.headers.get('api-key')).toBe('fixture-only-key');
    config.model.apiProtocol = 'messages'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    for (const stream of [undefined, {}]) {
      expect((await callModel(config, 'Test', [{ role: 'user', content: 'Hello' }], [], stream)).content[0]?.text).toBe('Messages OK');
      expect(requests.at(-1)!.url.pathname).toBe('/v1/messages');
      expect(requests.at(-1)!.headers.get('api-key')).toBe('fixture-only-key');
      expect(requests.at(-1)!.body.max_tokens).toBe(config.model.maxOutputTokens);
    }
    const count = requests.length; delete process.env.CCPT_TEST_AZURE_KEY;
    await expect(callModel(config, '', [], [])).rejects.toThrow('environment variable is not configured'); expect(requests.length).toBe(count);
  } finally {
    server.stop(true);
    for (const [name, value] of [['CCPT_HOME', prior.home], ['CCPT_TEST_AZURE_KEY', prior.key], ['CCPT_CLI_ENTRY', prior.entry]] as const) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await removeOwnedTemporaryFixture(root);
  }
}, 30000);

test('CA certificate path accepts PEM content regardless of .per extension, rejects private keys and invalid files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-ca-'));
  try {
    const path = join(root, 'ca.per'); await writeFile(path, tls.rootCertificates[0]!);
    expect(await readCaCertificates(path)).toHaveLength(1);
    await writeFile(path, 'not a certificate'); await expect(readCaCertificates(path)).rejects.toThrow('PEM');
    await writeFile(path, `${tls.rootCertificates[0]}\n-----BEGIN PRIVATE KEY-----`); await expect(readCaCertificates(path)).rejects.toThrow('private key');
  } finally { await rm(root, { recursive: true, force: true }); }
});

const pwsh = Bun.which('pwsh');
test.skipIf(!pwsh)('HTTPS accepts a configured private CA and still rejects an untrusted server without it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-private-ca-'));
  const generated = Bun.spawnSync([pwsh!, '-NoProfile', '-NonInteractive', '-Command', `$rsa = [System.Security.Cryptography.RSA]::Create(2048); $req = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1); $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new(); $san.AddDnsName('localhost'); $san.AddIpAddress([System.Net.IPAddress]::Loopback); $req.CertificateExtensions.Add($san.Build()); $req.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true)); $cert = $req.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(1)); @{cert=$cert.ExportCertificatePem();key=$rsa.ExportPkcs8PrivateKeyPem()} | ConvertTo-Json -Compress`]);
  expect(generated.exitCode).toBe(0);
  const material = JSON.parse(generated.stdout.toString());
  const server = Bun.serve({ port: 0, tls: material, fetch() { return Response.json({ trusted: true }); } });
  try {
    const caFile = join(root, 'company-ca.per'); await writeFile(caFile, material.cert);
    const network = { ...defaultConfig.network, proxyUrl: '', timeoutMs: 5000, allowedHosts: [], rejectUnauthorized: true };
    const url = `https://127.0.0.1:${server.port}/test`;
    await expect(networkJson(url, {}, network)).rejects.toThrow();
    expect((await networkJson<{ trusted: boolean }>(url, {}, { ...network, caFile })).value.trusted).toBe(true);
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 30000);
