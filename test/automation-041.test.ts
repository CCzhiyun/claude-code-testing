import { test, expect } from 'bun:test';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';

test('CLI stream input preserves one Agent/session and temporary overrides reach the request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-stream-input-')), state = join(root, 'state');
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body = await request.json(); requests.push(body);
    if (requests.length === 1) return Response.json({ error: { type: 'rate_limit_error', message: 'temporary TPM limit' } }, { status: 429, headers: { 'retry-after-ms': '20' } });
    return Response.json({ choices: [{ message: { content: 'REPLY_OK' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 5 } });
  } });
  const config = structuredClone(defaultConfig); config.model.apiProtocol = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.port}`;
  config.policy.workspaceRoots = [root]; config.marketplaceEnabled = false; config.agents.defaultIsolation = 'none'; config.network.proxyUrl = '';
  config.modelRetry = { baseDelayMs: 1, maxRetries: 2, maxWaitMs: 1000 };
  await writeJson(join(root, '.ccpt', 'settings.json'), config);
  const run = async (args: string[], input?: string) => {
    const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../src/cli.ts'), ...args], { cwd: root, env: { ...process.env, CCPT_HOME: state, CCPT_MANAGED_CONFIG: join(root, 'no-managed.json') }, stdin: input === undefined ? 'ignore' : new Blob([input]), stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { out, err, code };
  };
  try {
    const input = ['Remember the number 42', 'What number did I give you?'].map((content) => JSON.stringify({ type: 'user', message: { role: 'user', content } })).join('\n');
    const runResult = await run(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--settings', '{"model":{"maxOutputTokens":1800}}', '--tools', 'read_file', '--max-requests', '3'], input);
    expect(runResult.code, runResult.err + runResult.out).toBe(0);
    expect(runResult.out).toContain('model_retry');
    const results = runResult.out.trim().split('\n').map((line) => JSON.parse(line)).filter((value) => value.type === 'result');
    expect(results).toHaveLength(2); expect(results[0].agent_id).toBe(results[1].agent_id); expect(results[0].session_id).toBe(results[1].session_id);
    expect(requests[0].max_tokens).toBe(1800); expect(requests[0].tools.map((tool: any) => tool.function.name)).toEqual(['read_file']);
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(requests[2].messages)).toContain('Remember the number 42');
    const sessionsBefore = await readdir(join(state, 'sessions'));
    const ephemeral = await run(['-p', 'Hello', '--no-session-persistence', '--output-format', 'json']);
    expect(ephemeral.code, ephemeral.err + ephemeral.out).toBe(0); expect(JSON.parse(ephemeral.out).resumable).toBe(false);
    expect(await readdir(join(state, 'sessions'))).toEqual(sessionsBefore);
    const persisted = JSON.parse(await readFile(join(root, '.ccpt', 'settings.json'), 'utf8'));
    expect(persisted.model.maxOutputTokens).toBe(config.model.maxOutputTokens);
    const budget = await run(['-p', 'Continue', '--resume', results[0].session_id, '--max-requests', '2', '--output-format', 'json']);
    expect(budget.code, budget.err + budget.out).toBe(2); expect(JSON.parse(budget.out).status).toBe('waiting_for_input');
    expect(JSON.parse(budget.out).session_id).toBe(results[0].session_id);
  } finally { server.stop(true); }
}, 30_000);
