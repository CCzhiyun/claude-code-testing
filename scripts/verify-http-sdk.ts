// Built Node CLI/SDK exercise. All endpoints, keys and publisher records are temporary fixtures.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { generateKeyPairSync } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { controlProcess } from '../src/executionControl.js';
import { signPlugin } from '../src/pluginSignatures.js';

const project = resolve(import.meta.dir, '..'), root = await mkdtemp(join(tmpdir(), 'ccpt-http-sdk-'));
const env: Record<string, string> = { CCPT_HOME: join(root, 'home') };
for (const name of ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
let modelCalls = 0, toolCalls = 0, deletes = 0;
const requests: any[] = [], streams = new Map<string, { controller: ReadableStreamDefaultController<Uint8Array>; parent: number }>();
const key = 'fixture-only-http-key', encoder = new TextEncoder();
const emit = (controller: ReadableStreamDefaultController<Uint8Array>, value: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`));
const server = Bun.serve({ port: 0, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/v1/responses') {
    if (request.headers.get('api-key') !== key) return new Response(null, { status: 401 });
    const body = await request.json() as any; requests.push(body); modelCalls++;
    return Response.json({ id: 'resp_fixture', object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'BUILT-HTTP-SAMPLE' }] }] });
  }
  if (url.pathname !== '/mcp') return new Response(null, { status: 404 });
  const session = request.headers.get('mcp-session-id') ?? '';
  if (request.method === 'DELETE') { deletes++; streams.delete(session); return new Response(null, { status: 204 }); }
  const rpc: any = await request.json();
  if (rpc.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }, { headers: { 'mcp-session-id': `fixture-${crypto.randomUUID()}` } });
  if (!session || request.headers.get('mcp-protocol-version') !== '2025-06-18') return new Response(null, { status: 400 });
  if (rpc.method === 'notifications/initialized' || rpc.method === 'notifications/cancelled') return new Response(null, { status: 202 });
  if (rpc.method === 'tools/call') {
    toolCalls++;
    const reverse = rpc.params.name === 'form'
      ? { method: 'elicitation/create', params: { message: '选择项目', requestedSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } } }
      : { method: 'sampling/createMessage', params: { messages: [{ role: 'user', content: { type: 'text', text: 'FIXTURE-HTTP-REQUEST' } }], maxTokens: 64 } };
    return new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.set(session, { controller, parent: rpc.id }); emit(controller, { jsonrpc: '2.0', id: rpc.id, ...reverse }); } }), { headers: { 'content-type': 'text/event-stream' } });
  }
  const pending = streams.get(session);
  if (!rpc.method && pending && rpc.id === pending.parent) {
    emit(pending.controller, { jsonrpc: '2.0', id: pending.parent, result: { reverse: rpc } }); pending.controller.close(); streams.delete(session);
    return new Response(null, { status: 202 });
  }
  return new Response(null, { status: 400 });
} });
const config = structuredClone(defaultConfig);
config.marketplaceEnabled = false; config.disableBundledSkills = true; config.hooks = []; config.policy.workspaceRoots = [root];
config.model.apiProtocol = 'responses'; config.model.apiKeyEnv = ''; config.model.credentialRef = 'fixture'; config.model.apiKeyHeader = 'api-key'; config.model.apiKeyPrefix = '';
config.model.endpointUrl = `http://127.0.0.1:${server.port}/v1/responses`; config.model.responsesStore = true;
config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 10000 };
config.mcpServers = { fixture: { transport: 'http', httpMode: 'streamable', url: `http://127.0.0.1:${server.port}/mcp` } };

async function run(args: string[], input?: string, approvals?: string[]) {
  const child = spawn('node', args, { cwd: root, env, windowsHide: true, detached: process.platform !== 'win32', stdio: 'pipe' });
  const control = controlProcess(child, 20000); let stdout = '', stderr = '', offset = 0;
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
    const marker = 'Type yes to approve once'; let found: number;
    while (approvals && (found = stderr.indexOf(marker, offset)) !== -1) { offset = found + marker.length; const answer = approvals.shift(); if (answer !== undefined) child.stdin.write(answer + '\n'); }
  });
  if (!approvals) { if (input) child.stdin.write(input); child.stdin.end(); }
  try {
    const code = await new Promise<number | null>((done, reject) => { child.once('error', reject); child.once('close', done); });
    if ((stdout + stderr).includes(key)) throw new Error('Fixture credential leaked');
    if (code !== 0 || control.error()) throw new Error(control.error()?.message ?? stderr);
    return stdout;
  } finally { control.dispose(); }
}
const cli = (args: string[], input?: string) => run([join(project, 'dist/cli.js'), ...args, '--cwd', root], input);
const interactive = async (answers: string[]) => {
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); Object.defineProperty(process.stderr,'isTTY',{value:true}); process.argv=['node','cli','mcp','call','fixture','sample','--interactive','--cwd',${JSON.stringify(root)}]; await import(${JSON.stringify(pathToFileURL(join(project, 'dist/cli.js')).href)});`;
  return JSON.parse(await run(['--input-type=module', '-e', script], undefined, answers));
};
try {
  if (process.platform !== 'win32') throw new Error('This smoke explicitly exercises Windows DPAPI');
  await writeJson(join(root, '.ccpt/settings.json'), config);
  await cli(['credentials', 'set', 'fixture', '--stdin'], key + '\n');
  const denied = JSON.parse(await cli(['mcp', 'call', 'fixture', 'sample']));
  if (denied.reverse.error.code !== -32601 || modelCalls !== 0) throw new Error('Default HTTP approval policy changed');
  if ((await interactive(['no'])).reverse.error.code !== -1 || modelCalls !== 0) throw new Error('Pre-model refusal failed');
  const hidden = await interactive(['yes', 'no']);
  if (hidden.reverse.error.code !== -1 || JSON.stringify(hidden).includes('BUILT-HTTP-SAMPLE')) throw new Error('Pre-share refusal failed');
  if ((await interactive(['yes', 'yes'])).reverse.result.content.text !== 'BUILT-HTTP-SAMPLE') throw new Error('Approved result missing');
  if (modelCalls !== 2 || requests.some(body => !body.input || body.messages || body.store !== false || body.previous_response_id || body.tools?.length || body.max_output_tokens !== 64)) throw new Error('Sampling was not an isolated native Responses request');
  const sdkScript = `const sdk=await import(${JSON.stringify(pathToFileURL(join(project, 'dist/entrypoints/sdk.js')).href)}); const config=await sdk.loadSettings(${JSON.stringify(root)}); const result=await sdk.callMcpServer('fixture',config.mcpServers.fixture,'form',{},true,undefined,config,{elicit:async()=>({action:'accept',content:{project:'中文应用'}})}); process.stdout.write(JSON.stringify(result));`;
  const form = JSON.parse(await run(['--input-type=module', '-e', sdkScript]));
  if (form.reverse.result.content.project !== '中文应用' || toolCalls !== 5 || deletes !== 5) throw new Error('Built SDK form/session lifecycle differs');
  const keys = generateKeyPairSync('ed25519'), privateFile = join(root, 'fixture-signing.pem'), catalog = join(root, 'catalog'), plugin = join(catalog, 'team');
  await writeFile(privateFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  config.marketplaceEnabled = true; config.requirePluginSignatures = true; config.pluginTrustKeys = { fixture: String(keys.publicKey.export({ type: 'spki', format: 'pem' })) };
  await writeJson(join(root, '.ccpt/settings.json'), config);
  await writeJson(join(plugin, 'plugin.json'), { name: 'team', version: '1.0.0', contributes: {} }); await signPlugin(plugin, privateFile, 'fixture');
  await writeJson(join(catalog, '.claude-plugin/marketplace.json'), { name: 'fixture-catalog', owner: { name: 'Fixture' }, plugins: [{ name: 'team', version: '1.0.0', source: './team' }] });
  await cli(['plugin', 'marketplace', 'add', catalog]); await cli(['plugin', 'install', 'team@fixture-catalog']);
  const receipt = join(root, '.ccpt/plugin-installations/project/team.json');
  await readFile(receipt); await rm(receipt);
  if (JSON.parse(await cli(['plugin', 'sources']))[0].state !== 'untracked') throw new Error('Missing receipt was silently inferred');
  await cli(['plugin', 'repair-source', 'team@fixture-catalog', '--confirm']);
  if (JSON.parse(await cli(['plugin', 'sources']))[0].state !== 'verified-receipt') throw new Error('Explicit local source repair failed');
  await cli(['plugin', 'uninstall', 'team']);
  const report = { pass: true, runtime: 'built Node CLI + SDK', checks: ['HTTP POST/SSE default deny', 'two independent readline sampling approvals', 'native Responses sampling without tools/history/store', 'SDK UTF-8 elicitation', 'colliding reverse IDs, negotiated session headers and DELETE cleanup', 'signed source inspection and explicit exact-byte receipt repair'], modelRequests: modelCalls, endpointScope: 'loopback fixtures only', terminalScope: 'real readline path with fixture-only TTY override; not physical ConPTY certification', companyRequests: 0, userSettingsModified: false };
  await writeJson(join(project, '.ccpt/http-sdk-20261017/final/packaged-http-sdk-smoke.json'), report); console.log(JSON.stringify(report, null, 2));
} finally {
  server.stop(true);
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture cleanup target');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
