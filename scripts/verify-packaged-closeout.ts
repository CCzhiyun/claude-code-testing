// Run the distributable with Node, isolated state, DPAPI and a loopback Responses fixture.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';

if (process.platform !== 'win32') throw new Error('This smoke verifies the Windows DPAPI backend');
const project = resolve(import.meta.dir, '..');
const root = await mkdtemp(join(tmpdir(), 'ccpt-packaged-closeout-'));
const key = 'fixture-only-packaged-key-20261017';
const requests: Array<{ input: unknown; messages: unknown; authenticated: boolean }> = [];
const server = Bun.serve({ port: 0, async fetch(request) {
  if (new URL(request.url).pathname !== '/v1/responses') return new Response('Wrong protocol endpoint', { status: 404 });
  const body = await request.json() as any;
  requests.push({ input: body.input, messages: body.messages, authenticated: request.headers.get('api-key') === key });
  return Response.json({ id: `resp_fixture_${requests.length}`, object: 'response', status: 'completed', output: [{ type: 'message', id: `msg_fixture_${requests.length}`, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Packaged Responses verified', annotations: [] }] }], usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } });
} });
const env = { ...process.env };
for (const name of Object.keys(env)) if (/^(CCPT_|OPENAI_|ANTHROPIC_|AZURE_OPENAI_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NODE_EXTRA_CA_CERTS)/i.test(name)) delete env[name];
env.CCPT_HOME = join(root, 'state');
env.CCPT_CLI_ENTRY = join(project, 'dist/cli.js');
const config = structuredClone(defaultConfig);
config.marketplaceEnabled = false; config.disableBundledSkills = true; config.hooks = [];
config.model.apiProtocol = 'responses'; config.model.provider = 'openai'; config.model.name = 'fixture-model';
config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/responses`;
config.model.apiKeyHeader = 'api-key'; config.model.apiKeyPrefix = ''; config.model.apiKeyEnv = ''; config.model.credentialRef = 'packaged';
config.agents.defaultIsolation = 'none'; config.policy.workspaceRoots = [root]; config.network.allowedHosts = ['127.0.0.1']; delete config.network.proxyUrl;
async function cli(args: string[], extra: Record<string, string> = {}) {
  const child = Bun.spawn(['node', join(project, 'dist/cli.js'), ...args, '--cwd', root], { cwd: root, env: { ...env, ...extra }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill(), 30000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if ((stdout + stderr).includes(key)) throw new Error('Credential leaked into CLI output');
    return { stdout, stderr, code };
  } finally { clearTimeout(timer); }
}
function requireSuccess(result: { code: number; stderr: string }) { if (result.code !== 0) throw new Error(`Node CLI failed: ${result.stderr}`); }
try {
  await writeJson(join(root, '.ccpt/settings.json'), config);
  requireSuccess(await cli(['credentials', 'set', 'packaged', '--from-env', 'FIXTURE_IMPORT_KEY'], { FIXTURE_IMPORT_KEY: key }));
  const vault = await readFile(join(root, 'state/model-credentials.dpapi.json'), 'utf8');
  if (vault.includes(key)) throw new Error('Credential was not protected at rest');
  requireSuccess(await cli(['doctor', 'export', 'support.json']));
  if (requests.length !== 0) throw new Error('Diagnostic export contacted a model');
  const support = await readFile(join(root, 'support.json'), 'utf8');
  if (support.includes(key)) throw new Error('Diagnostic export leaked credential');
  if ((await cli(['doctor', 'export', 'support.json'])).code === 0) throw new Error('Diagnostic export overwrote an existing file');
  const foreground = await cli(['--print', 'Inspect the packaged fixture', '--output-format', 'json']); requireSuccess(foreground);
  const result = JSON.parse(foreground.stdout);
  if (result.status !== 'completed' || result.result !== 'Packaged Responses verified') throw new Error('Foreground did not return the fixture response');
  const background = await cli(['run', 'Inspect the detached packaged fixture', '--background', '--no-worktree']); requireSuccess(background);
  const agent = JSON.parse(background.stdout);
  const completed = await cli(['agents', 'wait', agent.id, '--timeout', '20000']); requireSuccess(completed);
  if (JSON.parse(completed.stdout).status !== 'completed') throw new Error('Detached worker did not complete');
  if (requests.length !== 2 || requests.some(request => !request.authenticated || !request.input || request.messages !== undefined)) throw new Error('Responses wire contract/authentication did not match');
  const runtime = await readFile(join(root, 'state/agents-runtime', `${agent.id}.json`), 'utf8');
  if (runtime.includes(key)) throw new Error('Runtime config serialized a protected credential');
  requireSuccess(await cli(['credentials', 'remove', 'packaged']));
  const revoked = await cli(['--print', 'The removed reference must fail closed', '--output-format', 'json']);
  if (revoked.code === 0 || requests.length !== 2) throw new Error('Revoked credential reached the model service');
  const report = { pass: true, entrypoint: 'node dist/cli.js', checks: ['DPAPI encrypted import', 'local-only redacted diagnostics', 'exclusive diagnostic export', 'native Responses with Azure-style api-key', 'foreground and detached worker', 'no plaintext runtime credential', 'revocation fails closed'], modelRequests: '2 loopback fixtures only', corporateRequests: 0, userSettingsModified: false };
  await writeJson(join(project, '.ccpt/platform-closeout-20261017/final/packaged-closeout-smoke.json'), report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.stop(true);
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture cleanup target');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
