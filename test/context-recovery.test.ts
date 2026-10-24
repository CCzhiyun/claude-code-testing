import { expect, test } from 'bun:test';
import { defaultConfig } from '../src/config.js';
import { ContextLimitError, ModelRequestError, modelRequestError } from '../src/modelErrors.js';
import { queryWithContextRecovery } from '../src/contextRecovery.js';
import { QueryEngine } from '../src/QueryEngine.js';
import { fullSessionMessages } from '../src/sessions.js';
import { callModel } from '../src/model.js';
import type { SessionRecord } from '../src/types.js';
import { navigateConfig, type ConfigDialogState } from '../src/components/commandDialogs.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

function fixture() {
  const config = structuredClone(defaultConfig);
  config.model.maxContextTokens = 100000; config.model.maxOutputTokens = 256;
  const session: SessionRecord = { id: 'fixture', title: '', cwd: process.cwd(), createdAt: '', updatedAt: '', messages: [] };
  for (let i = 0; i < 12; i++) session.messages.push({ role: 'user', content: `Request ${i} ${'large old history '.repeat(250)}` }, { role: 'assistant', content: `Answer ${i}` });
  session.messages.push({ role: 'user', content: 'Keep the latest exact request 你好' });
  return { config, session };
}

test('recognizes explicit provider overflow but never auth, rate limit, generic payload or output parameter errors', () => {
  for (const status of [400, 413, 422]) expect(modelRequestError(status, { error: { code: 'context_length_exceeded', message: 'too large' } })).toBeInstanceOf(ContextLimitError);
  for (const status of [401, 403, 429, 500, 503]) expect(modelRequestError(status, { error: { code: 'context_length_exceeded', message: 'maximum context length' } })).toBeInstanceOf(ModelRequestError);
  for (const message of ['max_tokens must be at most 4096', 'Request body too large', 'Unknown parameter max_tokens']) expect(modelRequestError(400, { error: { message } })).not.toBeInstanceOf(ContextLimitError);
  expect(modelRequestError(400, { error: { code: 'rate_limit_error', message: 'maximum context length' } })).not.toBeInstanceOf(ContextLimitError);
  const error = modelRequestError(400, JSON.stringify({ error: { message: 'maximum context length is 8,192 tokens; requested 9500 tokens' } }));
  expect(error).toBeInstanceOf(ContextLimitError); expect((error as ContextLimitError).windowHint).toBe(8192);
});

for (const protocol of ['messages', 'chat-completions'] as const) test(`${protocol}: explicit SSE error event before output is recoverable`, async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response('event: error\ndata: {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}\n\n', { headers: { 'content-type': 'text/event-stream' } }) });
  try {
    const { config } = fixture(); config.model.apiProtocol = protocol; config.model.endpointUrl = `http://127.0.0.1:${server.port}`;
    await expect(callModel(config, '', [{ role: 'user', content: 'hi' }], [], {})).rejects.toBeInstanceOf(ContextLimitError);
  } finally { server.stop(true); }
});

test('CLI persists both token limits and rejects malformed or missing values without overwriting settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-token-flags-'));
  try {
    const cli = resolve(import.meta.dir, '../src/cli.ts');
    const run = async (args: string[]) => {
      const child = Bun.spawn([process.execPath, cli, '--cwd', root, ...args], { cwd: root, env: { ...process.env, CCPT_HOME: join(root, 'state') }, stdout: 'pipe', stderr: 'pipe' });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { code, text: out + err };
    };
    expect((await run(['config', 'set', '--max-context', '32768', '--max-output', '2048'])).code).toBe(0);
    const path = join(root, '.ccpt', 'settings.json'); const saved = await readFile(path, 'utf8');
    expect(JSON.parse(saved).model).toMatchObject({ maxContextTokens: 32768, maxOutputTokens: 2048 });
    const effective = await run(['config', 'show', '--max-context', '16000', '--max-output', '1000']);
    expect(effective.code).toBe(0); expect(JSON.parse(effective.text).model).toMatchObject({ maxContextTokens: 16000, maxOutputTokens: 1000 });
    for (const args of [['--max-output', '1.5'], ['--max-output'], ['--max-context', '0']]) {
      const result = await run(args); expect(result.code).not.toBe(0); expect(result.text).toContain('positive whole number');
    }
    expect(await readFile(path, 'utf8')).toBe(saved);
  } finally { await rm(root, { recursive: true, force: true }); }
}, 20000);

test('provider recovery archives exact originals, lowers only runtime window and saves before retry', async () => {
  const { config, session } = fixture(); const original = structuredClone(session.messages);
  const order: string[] = []; let calls = 0;
  await queryWithContextRecovery({ config, session, system: 'system', tools: [],
    async query() { order.push('query'); if (++calls === 1) throw new ContextLimitError('overflow', 'provider', 8192); return { content: [] }; },
    async onRecovery(notice) { order.push('save'); expect(notice.after).toBeLessThan(notice.before); },
  });
  expect(order).toEqual(['query', 'save', 'query']); expect(config.model.maxContextTokens).toBe(8192);
  expect(fullSessionMessages(session)).toEqual(original); expect(session.messages.at(-1)).toEqual(original.at(-1));
  expect(session.contextRecovery?.attempt).toBe(1); expect(session.contextSnapshot?.window).toBe(8192);
});

test('local budget recovery happens before any provider request and QueryEngine reads compacted messages', async () => {
  const { config, session } = fixture(); config.model.maxContextTokens = 6000;
  let calls = 0; let saves = 0;
  const engine = new QueryEngine(config, { now: Date.now, async callModel() { calls++; return { content: [] }; } });
  await queryWithContextRecovery({ config, session, system: '', tools: [], query: stream => engine.query('', session.messages, [], stream), async onRecovery() { saves++; } });
  expect(calls).toBe(1); expect(saves).toBe(1);
});

test('persistent overflow has a hard retry bound, not an infinite compression loop', async () => {
  const { config, session } = fixture(); let calls = 0;
  await expect(queryWithContextRecovery({ config, session, system: '', tools: [], async query() { calls++; throw new ContextLimitError('overflow', 'provider'); }, async onRecovery() {} })).rejects.toThrow('Recovery retry limit reached');
  expect(calls).toBe(3);
});

test('disabled auto compaction, partial output, and ordinary errors never retry or mutate history', async () => {
  for (const mode of ['disabled', 'partial', 'ordinary']) {
    const { config, session } = fixture(); const original = structuredClone(session); let calls = 0;
    if (mode === 'disabled') config.ui.autoCompact = false;
    await expect(queryWithContextRecovery({ config, session, system: '', tools: [], async query(stream) {
      calls++; if (mode === 'partial') stream.onTextDelta?.('Already shown');
      throw mode === 'ordinary' ? new Error('network failed') : new ContextLimitError('overflow', 'provider');
    }, async onRecovery() { throw new Error('must not save'); } })).rejects.toThrow();
    expect(calls).toBe(1); expect(session).toEqual(original);
  }
});

test('a single oversized tool exchange remains intact and returns actionable guidance', async () => {
  const { config, session } = fixture(); session.messages = [
    { role: 'user', content: 'Read huge file' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'read_file', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'large '.repeat(10000) }] },
  ]; const original = structuredClone(session); let calls = 0;
  await expect(queryWithContextRecovery({ config, session, system: '', tools: [], async query() { calls++; throw new ContextLimitError('overflow', 'provider'); }, async onRecovery() {} })).rejects.toThrow('No removable older complete turn');
  expect(calls).toBe(1); expect(session).toEqual(original);
});

test('persistence failure prevents retry after compaction', async () => {
  const { config, session } = fixture(); let calls = 0;
  await expect(queryWithContextRecovery({ config, session, system: '', tools: [], async query() { calls++; throw new ContextLimitError('overflow', 'provider'); }, async onRecovery() { throw new Error('disk full'); } })).rejects.toThrow('disk full');
  expect(calls).toBe(1);
});

for (const protocol of ['messages', 'chat-completions'] as const) {
  for (const streaming of [false, true]) test(`${protocol}: actual HTTP rejection preserves context error for ${streaming ? 'streaming' : 'JSON'}`, async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ error: { code: 'context_length_exceeded', message: 'maximum context length is 4096 tokens' } }, { status: 400 }) });
    try {
      const { config } = fixture(); config.model.apiProtocol = protocol; config.model.endpointUrl = `http://127.0.0.1:${server.port}/model`;
      await expect(callModel(config, '', [{ role: 'user', content: 'hi' }], [], streaming ? {} : undefined)).rejects.toBeInstanceOf(ContextLimitError);
    } finally { server.stop(true); }
  });
}

test('settings edits positive integer token limits, rejects malformed input without staging', () => {
  const { config } = fixture();
  const state: ConfigDialogState = { type: 'config', tab: 'Settings', query: 'Maximum context tokens', selected: 0, scroll: 0, focus: 'rows' };
  const facts = { cwd: '.', version: 'test', plugins: 0, skills: 0, agents: 0, activeAgents: 0, tasks: 0, sessionMessages: 0, estimatedTokens: 0 };
  navigateConfig(state, config, facts, 'space'); expect(state.editing?.row.editable).toBe('number');
  state.editing!.value = '0'; navigateConfig(state, config, facts, 'return'); expect(state.error).toContain('positive'); expect(state.pending).toBeUndefined();
  state.editing!.value = '32768'; navigateConfig(state, config, facts, 'return'); expect(state.pending).toEqual({ model: { maxContextTokens: 32768 } });
  expect(config.model.maxContextTokens).toBe(100000);
});
