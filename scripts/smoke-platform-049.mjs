// Native Node smoke against an npm-installed package; no production endpoints or credentials.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const installation = resolve(process.argv[2] ?? '.');
const protectedBackend = process.argv.includes('--protected');
const temporary = await mkdtemp(join(tmpdir(), 'ccpt-native-049-'));
if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid smoke workspace');
process.env.CCPT_HOME = join(temporary, 'home');
const sdk = await import(pathToFileURL(join(installation, 'node_modules/ccpt/dist/entrypoints/sdk.js')).href);
let authorization = '', exchanges = 0;
const server = createServer(async (request, response) => {
  try {
    let body = ''; for await (const chunk of request) body += chunk;
    const input = new URLSearchParams(body), auth = new URL(authorization);
    assert.equal(input.get('resource'), auth.searchParams.get('resource'));
    assert.equal(createHash('sha256').update(input.get('code_verifier')).digest('base64url'), auth.searchParams.get('code_challenge'));
    assert.equal(input.get('code'), 'native-code'); exchanges++;
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'native-test-secret', token_type: 'Bearer', expires_in: 3600 }));
  } catch { response.writeHead(400).end('{}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const definition = { transport: 'http', url: `${origin}/mcp`, oauth: { clientId: 'fixture', authorizationUrl: `${origin}/authorize`, tokenUrl: `${origin}/token` } };
async function save(path, value) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value)); }
async function cli(args, supplyCallback = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(installation, 'node_modules/ccpt/dist/cli.js'), ...args, '--cwd', temporary], { windowsHide: true, stdio: 'pipe', env: { ...process.env, DISABLE_AUTOUPDATER: '1' } });
    let stdout = '', stderr = '', supplied = false;
    const timer = setTimeout(() => { child.kill(); reject(new Error('Native CLI timeout')); }, 15000);
    child.stdout.on('data', chunk => {
      stdout += chunk;
      const match = stdout.match(/\n(http:\/\/127\.0\.0\.1:[^\r\n]+\/authorize\?[^\r\n]+)\n/);
      if (supplyCallback && match && !supplied) { supplied = true; authorization = match[1]; const auth = new URL(authorization), callback = new URL(auth.searchParams.get('redirect_uri')); callback.searchParams.set('state', auth.searchParams.get('state')); callback.searchParams.set('code', 'native-code'); child.stdin.write(callback.href + '\n'); }
    });
    child.stderr.on('data', chunk => { stderr += chunk; }); child.stdin.on('error', () => {});
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`Native CLI failed: ${stderr}`)); else resolve(stdout); });
  });
}
try {
  await save(join(temporary, '.ccpt/settings.json'), { marketplaceEnabled: false, mcpCredentialBackend: protectedBackend ? 'windows-dpapi' : 'file', mcpServers: { fixture: definition } });
  const config = await sdk.loadSettings(temporary);
  await sdk.loginMcpAuthorizationCode('sdk-fixture', definition, config, { onAuthorization: async details => {
    authorization = details.authorizationUrl; const auth = new URL(authorization), callback = new URL(details.redirectUri);
    callback.searchParams.set('state', auth.searchParams.get('state')); callback.searchParams.set('code', 'native-code');
    assert.equal((await fetch(callback)).status, 200);
  } });
  assert.equal(exchanges, 1);
  const output = await cli(['mcp', 'oauth-login', 'fixture', '--flow', 'code', '--manual', '--redirect-uri', 'http://127.0.0.1:33333/callback'], true);
  assert.match(output, /OAuth login completed/); assert(!output.includes('native-test-secret')); assert.equal(exchanges, 2);
  const stored = await readFile(join(temporary, protectedBackend ? 'home/mcp-tokens.dpapi.json' : 'home/mcp-tokens.json'), 'utf8'), tokens = JSON.parse(stored);
  if (protectedBackend) { assert.equal(tokens.backend, 'windows-dpapi'); assert(!stored.includes('native-test-secret')); }
  else assert.equal(tokens.fixture.binding.resource, `${origin}/mcp`);
  for (const version of ['1.0.0', '2.0.0']) await save(join(temporary, version, 'plugin.json'), { name: 'team', version });
  await sdk.installTrustedPlugin(temporary, join(temporary, '1.0.0'));
  await sdk.pluginOperations.updatePluginOp('team', join(temporary, '2.0.0'), 'project', temporary);
  const history = await sdk.listPluginHistory(temporary, 'team'); assert.equal(history.length, 1);
  const restored = JSON.parse(await cli(['plugin', 'rollback', 'team', history[0].id, '--confirm'])); assert.equal(restored.version, '1.0.0');
  await sdk.pluginOperations.disablePluginOp('team', 'project', temporary);
  assert((await sdk.loadSettings(temporary)).disabledPlugins.includes('team'));
  console.log(`Native Node installed-package smoke passed (${protectedBackend ? 'Windows DPAPI' : 'file'}): SDK loopback + CLI manual OAuth, PKCE/resource, plugin history/rollback, actual activation settings.`);
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(temporary, { recursive: true, force: true }); }
