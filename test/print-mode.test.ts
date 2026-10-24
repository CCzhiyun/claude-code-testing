import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';

test('print mode runs the Responses file-tool loop, persists continuity and returns parseable JSON/NDJSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-print-responses-'));
  const state = join(root, 'state'); const requests: any[] = [];
  let fail = false, ask = false;
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body: any = await request.json(); requests.push(body);
    if (fail) return Response.json({ id: 'resp_failed', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] });
    if (ask) return Response.json({ id: 'resp_ask', status: 'completed', output: [{ type: 'function_call', call_id: 'ask_call', name: 'ask_user', arguments: '{"question":"Which scope?"}' }] });
    const read = body.tools?.length && !body.input.some((item: any) => item.type === 'function_call_output');
    return Response.json({ id: read ? 'resp_read' : 'resp_done', status: 'completed', output: read ? [{ type: 'function_call', id: 'item_1', call_id: 'call_read', name: 'read_file', arguments: '{"path":"fixture.txt"}' }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'PRINT_RESPONSE_OK' }] }], usage: { input_tokens: 100, output_tokens: 5, input_tokens_details: { cached_tokens: 20 } } });
  } });
  const config = structuredClone(defaultConfig);
  config.model.apiProtocol = 'responses'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`; config.model.responsesStore = true;
  config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none'; config.marketplaceEnabled = false;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
  await writeJson(join(root, '.ccpt', 'settings.json'), config); await writeJson(join(state, 'settings.json'), config); await writeFile(join(root, 'fixture.txt'), 'REAL_FILE_CONTENT');
  const run = async (args: string[], stdin?: string) => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../src/cli.ts'), ...args], { cwd: root, env: { ...process.env, CCPT_HOME: state, DISABLE_AUTOUPDATER: '1' }, stdin: stdin === undefined ? 'ignore' : new Blob([stdin]), stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { out, err, code };
  };
  try {
    const first = await run(['-p', 'Read fixture.txt and report it', '--restricted', '--output-format', 'json']);
    expect(first.code, first.err + first.out).toBe(0); const parsed = JSON.parse(first.out);
    expect(parsed).toMatchObject({ type: 'result', schema_version: 1, status: 'completed', result: 'PRINT_RESPONSE_OK', is_error: false });
    expect(parsed.usage.records).toBe(2); expect(parsed.usage.inputTokens).toBe(200);
    expect(requests).toHaveLength(2); expect(requests[1].previous_response_id).toBe('resp_read');
    expect(requests[1].input[0]).toMatchObject({ type: 'function_call_output', call_id: 'call_read' }); expect(requests[1].input[0].output).toContain('REAL_FILE_CONTENT');
    const path = join(state, 'sessions', `${parsed.session_id}.json`); const original = await readFile(path, 'utf8');
    const fork = await run(['--print', 'Hello 你好', '--resume', parsed.session_id, '--fork-session', '--output-format', 'stream-json']);
    expect(fork.code, fork.err + fork.out).toBe(0);
    const lines = fork.out.trim().split('\n').map(line => JSON.parse(line));
    expect(lines[0].type).toBe('runtime'); expect(lines.at(-1)).toMatchObject({ type: 'result', status: 'completed' }); expect(lines.at(-1).session_id).not.toBe(parsed.session_id);
    expect(await readFile(path, 'utf8')).toBe(original);
    expect((await run(['--print'], 'Hello 你好')).out.trim()).toBe('PRINT_RESPONSE_OK');
    ask = true; const paused = await run(['-p', 'Plan a feature and ask me for scope', '--output-format', 'json']); expect(paused.code).toBe(2); expect(JSON.parse(paused.out)).toMatchObject({ status: 'waiting_for_input', is_error: true });
    ask = false; fail = true; const failed = await run(['-p', 'Hello', '--output-format', 'json']); expect(failed.code).toBe(1); expect(JSON.parse(failed.out)).toMatchObject({ status: 'failed', is_error: true });
    const startup = await run(['-p', 'Hello', '--fork-session', '--output-format', 'json']); expect(startup.code).toBe(1); expect(JSON.parse(startup.out).error).toContain('--resume');
  } finally { server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 30000);
