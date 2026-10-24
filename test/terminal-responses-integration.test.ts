import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { workspaceTrustKey } from '../src/workspaceTrust.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

for (const summaryMode of ['extractive', 'semantic'] as const) test(`terminal renders Responses settings, ${summaryMode} compaction notice and final model text`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-terminal-responses-')); const state = join(root, 'state');
  const requests: any[] = [];
  const summaryRequests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json() as any;
    if (body.instructions?.startsWith('Create a concise engineering handoff')) {
      summaryRequests.push(body);
      return Response.json({ id: 'resp_handoff', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Goal: summarize the previous discussion and inspect fixture.txt. No code changes verified. Pending: read the file and answer.' }] }], usage: { input_tokens: 500, output_tokens: 30 } });
    }
    requests.push(body);
    const text = requests.length > 2 ? 'RESPONSES_FOLLOWUP_DONE' : 'RESPONSES_UI_DONE';
    const response = { id: `resp_ui_${requests.length}`, status: 'completed', output: requests.length === 1 ? [{ type: 'function_call', call_id: 'ui_read', name: 'read_file', arguments: '{"path":"fixture.txt"}' }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 123, output_tokens: 8 } };
    return new Response(`${requests.length === 1 ? '' : `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\n`}data: ${JSON.stringify({ type: 'response.completed', response })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } });
  const config = structuredClone(defaultConfig);
  config.contextCompaction = { mode: summaryMode };
  config.model.apiProtocol = 'responses'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`; config.model.maxContextTokens = 18000; config.model.maxOutputTokens = 512;
  config.marketplaceEnabled = false; config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none';
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 10000 };
  await writeJson(join(root, '.ccpt', 'settings.json'), config); await writeJson(join(state, 'settings.json'), config);
  await writeFile(join(root, 'fixture.txt'), 'UI_TOOL_AFTER_COMPACT');
  await writeJson(join(state, 'workspace-trust.json'), { version: 1, workspaces: { [workspaceTrustKey(root)]: { trustedAt: new Date().toISOString() } } });
  const id = 'session_0000000000000040';
  const messages = Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i} ${'原'.repeat(summaryMode === 'semantic' ? 650 : 1000)}` }));
  await writeJson(join(state, 'sessions', `${id}.json`), { id, cwd: root, title: 'Responses context fixture', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages });
  const entry = pathToFileURL(resolve(import.meta.dir, '../src/tui.ts')).href;
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); process.stdin.setRawMode=()=>process.stdin; Object.defineProperty(process.stdout,'columns',{value:120}); Object.defineProperty(process.stdout,'rows',{value:42}); const {runTui}=await import(${JSON.stringify(entry)}); await runTui(process.cwd(),'fixture'); process.exit(0);`;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: root, env: { ...process.env, CCPT_HOME: state, DISABLE_AUTOUPDATER: '1', NO_COLOR: '1', CCPT_CLI_ENTRY: resolve(import.meta.dir, '../src/cli.ts') }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let output = ''; const collect = async (stream: ReadableStream<Uint8Array>) => { const decoder = new TextDecoder(); for await (const chunk of stream) output += decoder.decode(chunk, { stream: true }); };
  const pumps = Promise.all([collect(child.stdout), collect(child.stderr)]);
  const until = async (marker: string) => { const deadline = Date.now() + 15000; while (!output.includes(marker) && Date.now() < deadline) await Bun.sleep(25); expect(output.includes(marker), `Missing ${marker}\n${output.slice(-3500)}`).toBe(true); };
  const send = (keys: string) => { child.stdin.write(keys); child.stdin.flush(); };
  try {
    await until('/model to change'); send('/config\r'); await until('Type to filter'); send('API connection preset\r'); await until('Responses / Bearer');
    send('\u001b'); send('\u001b'); send('\u001b');
    send(`/resume ${id}\r`); await until('Resumed: Responses context fixture');
    send('Read fixture.txt and summarize our conversation.\r'); await until('Above 95%: auto-compacted'); await until('RESPONSES_UI_DONE');
    expect(requests).toHaveLength(2); expect(requests[0].input).toBeArray(); expect(requests[0].messages).toBeUndefined();
    expect(JSON.stringify(requests[1].input)).toContain('UI_TOOL_AFTER_COMPACT');
    const saved = JSON.parse(await readFile(join(state, 'sessions', `${id}.json`), 'utf8'));
    expect(saved.archivedMessages.length).toBeGreaterThan(0);
    expect(saved.compaction.method, JSON.stringify(saved.compaction)).toBe(summaryMode);
    expect(summaryRequests).toHaveLength(summaryMode === 'semantic' ? 1 : 0);
    if (summaryMode === 'semantic') {
      await until('Summary: semantic');
      expect(summaryRequests[0].tools ?? []).toHaveLength(0);
      expect(JSON.stringify(requests[0].input)).toContain('Model-generated handoff');
    }
    await Bun.sleep(150); send('Continue with one more short answer.\r'); await until('RESPONSES_FOLLOWUP_DONE'); await Bun.sleep(150);
    expect(requests).toHaveLength(3);
    const continued = JSON.parse(await readFile(join(state, 'sessions', `${id}.json`), 'utf8'));
    expect(continued.id).toBe(id); expect(JSON.stringify(continued.messages)).toContain('RESPONSES_FOLLOWUP_DONE');
    expect(continued.archivedMessages).toEqual(saved.archivedMessages);
    send('/exit\r'); await child.exited; await pumps;
  } finally { child.kill(); await child.exited; await pumps; server.stop(true); await removeOwnedTemporaryFixture(root); }
}, 30000);
