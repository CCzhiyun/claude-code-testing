// Real Node distributable, stdin DPAPI import and interactive MCP. Loopback fixtures only.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { controlProcess } from '../src/executionControl.js';
import { signPlugin } from '../src/pluginSignatures.js';
import { computePluginDigest } from '../src/plugins.js';

const project = resolve(import.meta.dir, '..'), root = await mkdtemp(join(tmpdir(), 'ccpt-packaged-interactions-'));
const key = 'fixture-only-interaction-key'; const requests: any[] = [];
const env: Record<string, string> = { CCPT_HOME: join(root, 'state') };
for (const name of ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
const server = Bun.serve({ port: 0, async fetch(request) {
  if (new URL(request.url).pathname !== '/v1/responses') return new Response('Wrong endpoint', { status: 404 });
  const body = await request.json() as any;
  if (request.headers.get('api-key') !== key) return new Response('Fixture auth failed', { status: 401 });
  requests.push(body);
  return Response.json({ id: `resp_${requests.length}`, object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'PACKAGED-INTERACTION-RESULT' }] }] });
} });
const config = structuredClone(defaultConfig); config.marketplaceEnabled = false; config.disableBundledSkills = true; config.hooks = []; config.policy.workspaceRoots = [root];
config.model.apiProtocol = 'responses'; config.model.apiKeyEnv = ''; config.model.credentialRef = 'fixture'; config.model.apiKeyHeader = 'api-key'; config.model.apiKeyPrefix = '';
config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/responses`; config.model.responsesStore = true;
config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 10000 };
config.mcpServers = { fixture: { transport: 'stdio', command: 'node', args: [join(project, 'test/mcp-interaction-fixture.cjs')] } };
async function cli(args: string[], input?: string) {
  const child = Bun.spawn(['node', join(project, 'dist/cli.js'), ...args, '--cwd', root], { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  if (input) child.stdin.write(input); child.stdin.end();
  const timer = setTimeout(() => child.kill(), 20000);
  try { const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); if ((stdout + stderr).includes(key)) throw new Error('Credential leaked into packaged CLI output'); if (code !== 0) throw new Error(stderr); return stdout; }
  finally { clearTimeout(timer); }
}
async function interactive(answers: string[]) {
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); Object.defineProperty(process.stderr,'isTTY',{value:true}); process.argv=['node','cli','mcp','call','fixture','fixture','--interactive','--cwd',${JSON.stringify(root)}]; await import(${JSON.stringify(pathToFileURL(join(project, 'dist/cli.js')).href)});`;
  const { spawn } = await import('node:child_process');
  const child = spawn('node', ['--input-type=module', '-e', script], { cwd: root, env, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe' });
  const control = controlProcess(child, 20000); let stdout = '', stderr = '', offset = 0;
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
    const marker = 'Type yes to approve once';
    let found: number;
    while ((found = stderr.indexOf(marker, offset)) !== -1) {
      offset = found + marker.length;
      const answer = answers.shift(); if (answer !== undefined) child.stdin.write(answer + '\n');
    }
  });
  try {
    const code = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit); });
    if (code !== 0 || control.error()) throw new Error(`Packaged interaction failed: ${control.error()?.message ?? stderr}`);
    if ((stdout + stderr).includes(key)) throw new Error('Credential leaked into interaction');
    return JSON.parse(stdout);
  } finally { control.dispose(); }
}
try {
  if (process.platform !== 'win32') throw new Error('This packaged smoke includes Windows DPAPI');
  await writeJson(join(root, '.ccpt/settings.json'), config);
  await cli(['credentials', 'set', 'fixture', '--stdin'], key + '\n');
  if ((await readFile(join(root, 'state/model-credentials.dpapi.json'), 'utf8')).includes(key)) throw new Error('Credential was not encrypted');
  const denied = JSON.parse(await cli(['mcp', 'call', 'fixture', 'fixture']));
  if (denied.reverse.error.code !== -32601 || requests.length) throw new Error('Default MCP path was not deny');
  if ((await interactive(['no'])).reverse.error.code !== -1 || requests.length) throw new Error('Unapproved sampling sent a model request');
  const hidden = await interactive(['yes', 'no']);
  if (hidden.reverse.error.code !== -1 || JSON.stringify(hidden).includes('PACKAGED-INTERACTION-RESULT')) throw new Error('Unapproved output was shared');
  const accepted = await interactive(['yes', 'yes']);
  if (accepted.reverse.result.content.text !== 'PACKAGED-INTERACTION-RESULT') throw new Error('Approved response was not shared');
  if (requests.length !== 2 || requests.some(body => !body.input || body.messages !== undefined || body.store !== false || body.previous_response_id || body.tools?.length || body.max_output_tokens !== 64)) throw new Error('Sampling was not isolated native Responses with the reviewed output cap');
  const sdkScript = `const sdk=await import(${JSON.stringify(pathToFileURL(join(project, 'dist/entrypoints/sdk.js')).href)}); const config=await sdk.loadSettings(${JSON.stringify(root)}); const result=await sdk.callMcpServer('fixture',config.mcpServers.fixture,'fixture',{reverse:{method:'elicitation/create',params:{message:'Choose a project',requestedSchema:{type:'object',properties:{project:{type:'string'}},required:['project']}}}},true,undefined,config,{elicit:async()=>({action:'accept',content:{project:'sdk-fixture'}})}); process.stdout.write(JSON.stringify({result,version:sdk.cli.CLI_VERSION,parsed:sdk.cli.parseCliInvocation(['-p','hello','--settings','{}'])}));`;
  const sdk = Bun.spawn(['node', '--input-type=module', '-e', sdkScript], { cwd: root, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const sdkTimer = setTimeout(() => sdk.kill(), 20000);
  let sdkResult: any;
  try { const [stdout, stderr, code] = await Promise.all([new Response(sdk.stdout).text(), new Response(sdk.stderr).text(), sdk.exited]); if (code !== 0) throw new Error(stderr); sdkResult = JSON.parse(stdout); }
  finally { clearTimeout(sdkTimer); }
  const packageInfo = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
  if (sdkResult.result.reverse.result.content.project !== 'sdk-fixture' || sdkResult.version !== packageInfo.version || sdkResult.parsed.command !== 'print') throw new Error('Built SDK interaction/parser exports differ from the executable');
  const keys = generateKeyPairSync('ed25519'), privateFile = join(root, 'fixture-signing.pem'), catalog = join(root, 'catalog'), plugin = join(catalog, 'team');
  await writeFile(privateFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  config.marketplaceEnabled = true; config.requirePluginSignatures = true; config.pluginTrustKeys = { fixture: String(keys.publicKey.export({ type: 'spki', format: 'pem' })) };
  await writeJson(join(root, '.ccpt/settings.json'), config);
  const publish = async (version: string) => {
    await writeJson(join(plugin, 'plugin.json'), { name: 'team', version, contributes: {} }); await signPlugin(plugin, privateFile, 'fixture');
    await writeJson(join(catalog, '.claude-plugin/marketplace.json'), { name: 'fixture-catalog', owner: { name: 'Fixture' }, plugins: [{ name: 'team', version, source: './team' }] });
  };
  await publish('1.0.0'); await cli(['plugin', 'marketplace', 'add', catalog]);
  const installed = (await cli(['plugin', 'install', 'team@fixture-catalog'])).trim();
  if (await computePluginDigest(installed) !== await computePluginDigest(plugin)) throw new Error('Packaged Marketplace changed signed artifact bytes');
  await publish('2.0.0'); await cli(['plugin', 'update', 'team@fixture-catalog']);
  const verified = JSON.parse(await cli(['plugin', 'verify']));
  if (!verified.ok || !verified.loaded.some((entry: any) => entry.name === 'team' && entry.version === '2.0.0' && entry.signatureVerified)) throw new Error('Packaged Node did not verify the signed Marketplace update');
  await cli(['plugin', 'uninstall', 'team']);
  const report = { pass: true, entrypoint: 'node dist/cli.js + dist/entrypoints/sdk.js', terminalFixture: 'real readline path with fixture-only isTTY override, not a physical ConPTY certification', checks: ['stdin encrypted credential import', 'default MCP denied', 'pre-model refusal sends no request', 'post-model refusal shares no sampled text', 'approved native Responses result', 'no tools/history/server-side storage; output cap 64', 'built SDK form callbacks, current parser and package version', 'signed Marketplace install/update/verification/uninstall on Node'], modelRequests: '2 loopback fixtures only', corporateRequests: 0, userSettingsModified: false };
  await writeJson(join(project, '.ccpt/platform-interactions-20261017/complete/packaged-interactions-smoke.json'), report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.stop(true);
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture cleanup target');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
