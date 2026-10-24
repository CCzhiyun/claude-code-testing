import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { workspaceTrustKey } from '../src/workspaceTrust.js';

test('raw-key terminal keeps chatting during MCP watch, exposes events/tasks, confirms stop, reload revokes and exit cleans up', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-terminal-mcp-watch-')); const state = join(root, 'state');
  const modelRequests: any[] = []; const methods: string[] = []; let gets = 0, deletes = 0, disconnected = 0;
  const server = Bun.serve({ port: 0, async fetch(request) {
    if (new URL(request.url).pathname === '/model') {
      modelRequests.push(await request.json());
      return Response.json({ choices: [{ message: { content: `CHAT-WHILE-WATCHING-${modelRequests.length}` } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }
    if (request.method === 'DELETE') { deletes++; return new Response(null, { status: 204 }); }
    if (request.method === 'GET') {
      gets++;
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(`id: first\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { data: 'UNTRUSTED-EVENT-DO-NOT-EXECUTE', token: 'sensitive-fixture-token' } })}\n\n`)); },
        cancel() { disconnected++; },
      }), { headers: { 'content-type': 'text/event-stream' } });
    }
    const body = await request.json() as any; methods.push(body.method);
    if (body.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }, { headers: { 'mcp-session-id': `fixture-${gets}` } });
    return new Response(null, { status: 202 });
  } });
  const config = structuredClone(defaultConfig);
  config.marketplaceEnabled = false; config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/model`;
  config.network = { allowedHosts: ['127.0.0.1'], timeoutMs: 5000, rejectUnauthorized: true };
  config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none'; config.hooks = [];
  config.pluginDirectories = []; config.skillsDirectories = []; config.agentsDirectories = [];
  config.mcpServers = { fixture: { transport: 'http', httpMode: 'streamable', url: `http://127.0.0.1:${server.port}/mcp` } };
  await writeJson(join(root, '.ccpt', 'settings.json'), config); await writeJson(join(state, 'settings.json'), config);
  await writeJson(join(state, 'workspace-trust.json'), { version: 1, workspaces: { [workspaceTrustKey(root)]: { trustedAt: new Date().toISOString() } } });
  const entry = pathToFileURL(resolve(import.meta.dir, '../src/tui.ts')).href;
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); process.stdin.setRawMode=()=>process.stdin; Object.defineProperty(process.stdout,'columns',{value:140}); Object.defineProperty(process.stdout,'rows',{value:48}); const {runTui}=await import(${JSON.stringify(entry)}); await runTui(process.cwd(),'fixture'); process.exit(0);`;
  const env: Record<string, string> = { CCPT_HOME: state, CCPT_API_KEY: 'fixture-only', CCPT_CLI_ENTRY: resolve(import.meta.dir, '../src/cli.ts'), NO_COLOR: '1', DISABLE_AUTOUPDATER: '1' };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let output = '', transcript = '';
  const collect = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) { const text = new TextDecoder().decode(chunk); output += text; transcript += text; } };
  const pumps = Promise.all([collect(child.stdout), collect(child.stderr)]);
  const until = async (marker: string) => { const deadline = Date.now() + 12000; while (!output.includes(marker) && Date.now() < deadline) await Bun.sleep(30); expect(output.includes(marker), `Missing ${marker}\n${output.slice(-6000)}`).toBe(true); output = ''; };
  const waitFor = async (check: () => boolean) => { const deadline = Date.now() + 3000; while (!check() && Date.now() < deadline) await Bun.sleep(20); expect(check()).toBe(true); };
  const send = (keys: string) => { child.stdin.write(keys); child.stdin.flush(); };
  try {
    await until('/model to change');
    send('/mcp\r'); await until('MCP servers'); expect(gets).toBe(0); send('\u001b'); await until('dismissed');
    send('/mcp watch fixture 60000\r'); await until('MCP listener started:'); await waitFor(() => gets === 1);
    send('Hello 你好\r'); await until('CHAT-WHILE-WATCHING-1');
    expect(modelRequests.length).toBe(1); expect(JSON.stringify(modelRequests)).not.toContain('UNTRUSTED-EVENT');
    send('/mcp watches\r'); await until('MCP notification listeners'); send('\r'); await until('UNTRUSTED-EVENT-DO-NOT-EXECUTE');
    send('x'); await until('Enter confirm'); send('\u001b'); await until('x stop'); expect(deletes).toBe(0);
    send('x\r'); await until(': cancelled'); await waitFor(() => deletes === 1 && disconnected === 1);
    send('\u001b'); await until('dismissed');
    const watchId = transcript.match(/mcpwatch_[a-f0-9-]{36}/)?.[0]; expect(watchId).toBeDefined();
    send(`/mcp events ${watchId}\r`); await until('UNTRUSTED-EVENT-DO-NOT-EXECUTE');
    send('Hello again\r'); await until('CHAT-WHILE-WATCHING-2');
    expect(modelRequests.length).toBe(2); expect(JSON.stringify(modelRequests)).not.toContain('UNTRUSTED-EVENT');
    send('/mcp watch fixture 60000\r'); await until('MCP listener started:'); await waitFor(() => gets === 2);
    config.network.timeoutMs = 4000; await writeJson(join(root, '.ccpt', 'settings.json'), config);
    send('/reload\r'); await until('Reloaded'); await waitFor(() => deletes === 2 && disconnected === 2);
    send('/tasks\r'); await until('Background tasks'); send('\u001b[C'); await until('MCP fixture'); send('\u001b[B\r'); await until('configuration changed');
    send('\u001b'); await until('↑/↓ move · Enter details'); send('\u001b'); await until('dismissed');
    send('/mcp watch fixture 60000\r'); await until('MCP listener started:'); await waitFor(() => gets === 3);
    // Exit must not reload broken disk settings or leave an owned listener alive.
    await writeFile(join(root, '.ccpt', 'settings.json'), '{broken-json');
    send('/exit\r'); const code = await Promise.race([child.exited, Bun.sleep(5000).then(() => -99)]); expect(code).toBe(0);
    await waitFor(() => deletes === 3 && disconnected === 3);
    expect(methods.filter(method => method === 'initialize').length).toBe(3);
    expect(methods.every(method => ['initialize', 'notifications/initialized'].includes(method))).toBe(true);
    expect(transcript).not.toContain('sensitive-fixture-token'); expect(modelRequests.length).toBe(2);
  } finally { child.kill(); await child.exited; await pumps; server.stop(true); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}, 60000);
