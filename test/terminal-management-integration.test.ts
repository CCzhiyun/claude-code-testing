import { expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import {removeOwnedTemporaryFixture} from './fixtureCleanup.js';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { workspaceTrustKey } from '../src/workspaceTrust.js';

test('raw-key TUI confirms MCP discovery, task stop and Agent attach, then visibly recovers provider overflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-terminal-management-')); const state = join(root, 'state');
  const methods: string[] = []; const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any;
    if (new URL(request.url).pathname === '/mcp') {
      if (request.method === 'DELETE') return new Response(null, { status: 204 });
      methods.push(body.method);
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'fixture-read', inputSchema: { type: 'object' } }] } });
    }
    requests.push(body);
    if (requests.length === 1) return Response.json({ error: { code: 'context_length_exceeded', message: 'The prompt is too long' } }, { status: 400 });
    return Response.json({ choices: [{ message: { content: 'RECOVERY-UI-DONE' } }], usage: { prompt_tokens: 101, completion_tokens: 8 } });
  } });
  const config = structuredClone(defaultConfig); config.marketplaceEnabled = false; config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/model`; config.model.maxContextTokens = 100000;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 10000 }; config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none'; config.hooks = [];
  config.mcpServers = { fixture: { transport: 'http', url: `http://127.0.0.1:${server.port}/mcp` } };
  config.pluginDirectories = []; config.skillsDirectories = []; config.agentsDirectories = [];
  await writeJson(join(root, '.ccpt', 'settings.json'), config); await writeJson(join(state, 'settings.json'), config);
  await writeJson(join(state, 'workspace-trust.json'), { version: 1, workspaces: { [workspaceTrustKey(root)]: { trustedAt: new Date().toISOString() } } });
  const sessionId = 'session_1111111111111139', agentId = 'agent_1111111111111139', queuedId = 'agent_2222222222222239';
  const now = new Date().toISOString();
  const messages = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `History ${i} ${'Architecture context '.repeat(80)}` }));
  await writeJson(join(state, 'sessions', `${sessionId}.json`), { id: sessionId, title: 'History fixture', cwd: root, createdAt: now, updatedAt: now, messages });
  const agent = { id: agentId, sessionId, role: 'coding', goal: 'History fixture', status: 'completed', cwd: root, depth: 0, createdAt: now, updatedAt: now };
  await writeJson(join(state, 'agents', `${agentId}.json`), agent);
  await writeJson(join(state, 'agents', `${queuedId}.json`), { ...agent, id: queuedId, goal: 'Queued fixture', status: 'queued' });
  const entry = pathToFileURL(resolve(import.meta.dir, '../src/tui.ts')).href;
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); process.stdin.setRawMode=()=>process.stdin; Object.defineProperty(process.stdout,'columns',{value:130}); Object.defineProperty(process.stdout,'rows',{value:42}); const {runTui}=await import(${JSON.stringify(entry)}); await runTui(process.cwd(),'fixture'); process.exit(0);`;
  const env: Record<string, string> = { CCPT_HOME: state, CCPT_API_KEY: 'fixture-only', CCPT_CLI_ENTRY: resolve(import.meta.dir, '../src/cli.ts'), NO_COLOR: '1', DISABLE_AUTOUPDATER: '1' };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let output = ''; let transcript = ''; const collect = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) { const text = new TextDecoder().decode(chunk); output += text; transcript += text; } };
  const pumps = Promise.all([collect(child.stdout), collect(child.stderr)]);
  const until = async (marker: string) => { const deadline = Date.now() + 10000; while (!output.includes(marker) && Date.now() < deadline) await Bun.sleep(30); expect(output.includes(marker), `Missing ${marker}\n${output.slice(-5000)}`).toBe(true); output = ''; };
  const send = (keys: string) => { child.stdin.write(keys); child.stdin.flush(); };
  try {
    await until('/model to change');
    send('/mcp\r'); await until('Ctrl+R refresh'); expect(methods).toHaveLength(0);
    send('\r'); await until('t test'); send('t'); await until('Enter confirm'); send('\u001b'); await until('t test'); expect(methods).toHaveLength(0);
    send('t\r'); await until('MCP discovery complete'); expect(methods).toEqual(['tools/list']);
    send('\u001b'); await until('Ctrl+R refresh'); send('\u001b'); await until('dismissed');
    send('/tasks\r'); await until('Queued fixture'); send('\r'); await until('x stop'); send('x'); await until('Enter confirm'); send('\u001b'); await until('x stop');
    expect(JSON.parse(await readFile(join(state, 'agents', `${queuedId}.json`), 'utf8')).status).toBe('queued');
    send('x\r'); await until(`${queuedId}: cancelled`); send('\u001b'); await until('dismissed');
    send('/agents\r'); await until('Ctrl+R refresh'); send('\u001b[C\u001b[C'); await until('History fixture'); send('History fixture'); await until('1/1'); send('\r'); await until('a attach');
    send('a'); await until('Enter confirm'); send('\r'); await until(`Attached Agent ${agentId}`); expect(requests).toHaveLength(0);
    send('Hello 你好\r'); await until('RECOVERY-UI-DONE');
    expect(transcript).toContain('Context recovery 1/2');
    expect(requests).toHaveLength(2); expect(JSON.stringify(requests[1]).length).toBeLessThan(JSON.stringify(requests[0]).length);
    const saved = JSON.parse(await readFile(join(state, 'sessions', `${sessionId}.json`), 'utf8'));
    expect(saved.contextRecovery.attempt).toBe(1); expect(saved.archivedMessages.length).toBeGreaterThan(0);
    expect(saved.messages.some((m: any) => m.content === 'Hello 你好')).toBe(true); expect(requests[1].tools ?? []).toEqual([]);
    send('/context\r'); await until('Output reserve:');
    send('/exit\r'); await Promise.race([child.exited, Bun.sleep(3000)]);
  } finally { child.kill(); await child.exited; await pumps; server.stop(true); await removeOwnedTemporaryFixture(root); }
}, 60000);
