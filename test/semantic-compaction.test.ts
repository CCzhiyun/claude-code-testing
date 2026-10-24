import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig, mergeConfig, validateConfig } from './legacyFixtureConfig.js';
import { compactSession, fullSessionMessages } from '../src/sessions.js';
import { refineCompaction } from '../src/semanticCompaction.js';
import { queryWithContextRecovery } from '../src/contextRecovery.js';
import { withExecutionSignal } from '../src/executionControl.js';
import { withSpendScope } from '../src/spending.js';
import { listUsage } from '../src/usage.js';
import { ContextLimitError } from '../src/modelErrors.js';
import type { SessionRecord } from '../src/types.js';

function fixture() {
  const config = structuredClone(defaultConfig);
  config.contextCompaction = { mode: 'semantic', maxInputTokens: 32000, maxOutputTokens: 1000, timeoutMs: 3000 };
  config.model.maxContextTokens = 20_000; config.model.maxOutputTokens = 1000;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 3000 };
  config.model.headersFromEnvironment = {}; config.model.apiKeyEnv = 'CCPT_TEST_COMPACT_KEY';
  const session: SessionRecord = { id: 'session_0000000000000046', cwd: '.', title: 'fixture', createdAt: '', updatedAt: '', messages: [] };
  for (let i = 0; i < 12; i++) session.messages.push({ role: 'user', content: `Goal ${i}: ${'约束'.repeat(300)}` }, { role: 'assistant', content: `Verified test ${i}` });
  session.messages.push({ role: 'user', content: 'LATEST: continue implementing' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'read1', name: 'read_file', input: { path: 'app.ts' } }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read1', content: 'current exact source' }] });
  return { config, session };
}
async function isolated(action: () => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-semantic-'));
  const priorHome = process.env.CCPT_HOME, priorKey = process.env.CCPT_TEST_COMPACT_KEY;
  process.env.CCPT_HOME = root; process.env.CCPT_TEST_COMPACT_KEY = 'fixture-sensitive-token';
  try { await action(); } finally {
    if (priorHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = priorHome;
    if (priorKey === undefined) delete process.env.CCPT_TEST_COMPACT_KEY; else process.env.CCPT_TEST_COMPACT_KEY = priorKey;
    await rm(root, { recursive: true, force: true });
  }
}

test('semantic policy validates bounds and respects layered overrides', () => {
  const config = fixture().config; validateConfig(config);
  expect(mergeConfig(config, { contextCompaction: { mode: 'extractive' } }).contextCompaction).toMatchObject({ mode: 'extractive', maxInputTokens: 32000 });
  for (const value of [null, [], { mode: 'surprise' }, { maxInputTokens: -1 }, { maxOutputTokens: 8001 }, { timeoutMs: 120001 }]) {
    expect(() => validateConfig({ ...config, contextCompaction: value } as any)).toThrow('contextCompaction');
  }
});

test('semantic compaction uses all three protocols, no tools or stored state; archives and current tool turn stay exact', async () => isolated(async () => {
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(await request.json());
    const text = 'Goal: preserve architecture. Verified: tests passed. Pending: update app.ts. fixture-sensitive-token';
    if (request.url.endsWith('/messages')) return Response.json({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 500, output_tokens: 40 } });
    if (request.url.endsWith('/responses')) return Response.json({ id: 'resp_summary', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 500, output_tokens: 40 } });
    return Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 40 } });
  } });
  try {
    for (const protocol of ['messages', 'responses', 'chat-completions'] as const) {
      const { config, session } = fixture(); config.model.apiProtocol = protocol;
      config.model.endpointUrl = `http://127.0.0.1:${server.port}/${protocol === 'chat-completions' ? 'chat/completions' : protocol}`;
      session.messages[0]!.content += ' fixture-sensitive-token';
      session.messages[1]!.content = [{ type: 'thinking', text: 'PRIVATE_REASONING' }, { type: 'image', media_type: 'image/png', data: 'IMAGE_BYTES' }, { type: 'text', text: 'Verified tests' }];
      const original = structuredClone(session.messages); compactSession(session, 5000, { force: true });
      let saves = 0;
      expect(await refineCompaction({ config, session, archiveOffset: 0, persist: async () => { saves++; } })).toBe(true);
      expect(saves).toBe(1); expect(session.compaction?.method).toBe('semantic');
      expect(fullSessionMessages(session)).toEqual(original); expect(session.messages.slice(-3)).toEqual(original.slice(-3));
      expect(session.summary).toContain('[redacted]'); expect(session.summary).not.toContain('fixture-sensitive-token');
      const body = requests.at(-1);
      expect(body.tools ?? []).toHaveLength(0); expect(body.previous_response_id).toBeUndefined(); expect(body.thinking).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain('PRIVATE_REASONING'); expect(JSON.stringify(body)).not.toContain('IMAGE_BYTES'); expect(JSON.stringify(body)).not.toContain('fixture-sensitive-token');
      if (protocol === 'responses') { expect(body.store).toBe(false); expect(body.text).toBeUndefined(); }
    }
    const usage = await listUsage(); expect(usage).toHaveLength(3);
    expect(usage.every(row => row.agentId === 'context-compaction' && row.inputSource === 'reported' && row.inputTokens === 500)).toBe(true);
  } finally { server.stop(true); }
}));

test('default/extractive and oversized summary input never call a provider; failed and truncated summaries retain excerpts', async () => isolated(async () => {
  let calls = 0, fail = true;
  const server = Bun.serve({ port: 0, fetch() { calls++; return fail ? Response.json({ error: 'private failure' }, { status: 400 }) : Response.json({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }); } });
  try {
    const { config, session } = fixture(); config.model.endpointUrl = `http://127.0.0.1:${server.port}/chat/completions`; compactSession(session, 5000, { force: true });
    const original = structuredClone(session.messages); delete config.contextCompaction;
    expect(await refineCompaction({ config, session, archiveOffset: 0, persist: async () => {} })).toBe(false); expect(calls).toBe(0);
    config.contextCompaction = { mode: 'semantic', maxInputTokens: 1 };
    await refineCompaction({ config, session, archiveOffset: 0, persist: async () => {} });
    expect(calls).toBe(0); expect(session.compaction?.fallback).toBe('input-limit');
    config.contextCompaction.maxInputTokens = 32000;
    await refineCompaction({ config, session, archiveOffset: 0, persist: async () => {} });
    expect(calls).toBe(1); expect(session.compaction?.fallback).toBe('request-failed'); expect(JSON.stringify(session.compaction)).not.toContain('private failure');
    fail = false;
    await refineCompaction({ config, session, archiveOffset: 0, persist: async () => {} });
    expect(session.compaction?.fallback).toBe('invalid-summary'); expect(session.messages).toEqual(original);
  } finally { server.stop(true); }
}));

test('semantic deadline falls back; user cancellation propagates with the existing checkpoint unchanged', async () => isolated(async () => {
  let started!: () => void;
  let start = new Promise<void>(resolve => { started = resolve; });
  const server = Bun.serve({ port: 0, fetch() { started(); return new Promise<Response>(() => {}); } });
  try {
    const { config, session } = fixture(); config.model.endpointUrl = `http://127.0.0.1:${server.port}/chat/completions`; compactSession(session, 5000, { force: true });
    config.contextCompaction!.timeoutMs = 40;
    await refineCompaction({ config, session, archiveOffset: 0, persist: async () => {} });
    expect(session.compaction?.fallback).toBe('timeout');
    config.contextCompaction!.timeoutMs = 3000; const before = structuredClone(session);
    start = new Promise<void>(resolve => { started = resolve; });
    const controller = new AbortController();
    const pending = withExecutionSignal(controller.signal, () => refineCompaction({ config, session, archiveOffset: 0, persist: async () => {} }));
    await start; controller.abort(new Error('User cancelled'));
    await expect(pending).rejects.toThrow('User cancelled'); expect(session).toEqual(before);
  } finally { server.stop(true); }
}));

test('automatic refinement saves the archive before paid work and the handoff before continuing the same conversation', async () => isolated(async () => {
  const order: string[] = [];
  const server = Bun.serve({ port: 0, fetch() { order.push('summary'); return Response.json({ choices: [{ message: { content: 'Preserve objectives and verified tests.' }, finish_reason: 'stop' }] }); } });
  try {
    const { config, session } = fixture(); config.model.maxContextTokens = 8000; config.model.endpointUrl = `http://127.0.0.1:${server.port}/chat/completions`;
    const original = structuredClone(session.messages);
    await queryWithContextRecovery({ config, session, system: '', tools: [], onPressure: async () => { order.push(`save-${session.compaction?.method}`); }, onRecovery: async () => {}, query: async () => { order.push('continue'); return { content: [] }; } });
    expect(order).toEqual(['save-extractive', 'summary', 'save-semantic', 'continue']); expect(fullSessionMessages(session)).toEqual(original);
    const next = fixture(); next.config.model.maxContextTokens = 8000; next.config.model.endpointUrl = config.model.endpointUrl;
    order.length = 0;
    await expect(queryWithContextRecovery({ ...next, system: '', tools: [], onPressure: async () => { throw new Error('disk full'); }, onRecovery: async () => {}, query: async () => { order.push('continue'); return { content: [] }; } })).rejects.toThrow('disk full');
    expect(order).toEqual([]);
    let saves = 0;
    const failedSave = fixture(); failedSave.config.model.maxContextTokens = 8000; failedSave.config.model.endpointUrl = config.model.endpointUrl;
    await expect(queryWithContextRecovery({ ...failedSave, system: '', tools: [], onPressure: async () => { if (++saves === 2) throw new Error('summary disk full'); }, onRecovery: async () => {}, query: async () => { order.push('continue'); return { content: [] }; } })).rejects.toThrow('summary disk full');
    expect(order).toEqual(['summary']);
  } finally { server.stop(true); }
}));

test('provider overflow recovery also checkpoints semantic handoffs and preserves original turns', async () => isolated(async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json({ choices: [{ message: { content: 'Verified constraints. Next: continue latest request.' }, finish_reason: 'stop' }] }) });
  try {
    const { config, session } = fixture(); config.model.maxContextTokens = 8000; config.model.endpointUrl = `http://127.0.0.1:${server.port}/chat/completions`;
    const original = structuredClone(session.messages); let attempts = 0; const saves: string[] = [];
    await queryWithContextRecovery({ config, session, system: '', tools: [], onRecovery: async () => { saves.push(session.compaction!.method); }, query: async () => {
      if (attempts++ === 0) throw new ContextLimitError('context overflow', 'provider');
      expect(session.compaction?.method).toBe('semantic'); return { content: [] };
    } });
    expect(attempts).toBe(2); expect(saves).toEqual(['extractive', 'semantic']); expect(fullSessionMessages(session)).toEqual(original);
  } finally { server.stop(true); }
}));

test('semantic calls consume shared request budgets and never bypass exhausted limits', async () => isolated(async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, fetch() { calls++; return Response.json({ choices: [{ message: { content: 'Handoff' }, finish_reason: 'stop' }] }); } });
  try {
    await withSpendScope('semantic-budget', async () => {
      for (let i = 0; i < 2; i++) {
        const { config, session } = fixture(); config.spending = { maxRequests: 1 }; config.model.endpointUrl = `http://127.0.0.1:${server.port}/chat/completions`; compactSession(session, 5000, { force: true });
        const action = refineCompaction({ config, session, archiveOffset: 0, persist: async () => {} });
        if (i === 0) await action; else await expect(action).rejects.toThrow('budget');
      }
    }); expect(calls).toBe(1);
  } finally { server.stop(true); }
}));
