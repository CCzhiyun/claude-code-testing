import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { responsesRequest, responseHistoryHash } from '../src/responsesModel.js';
import { rebaseCompactedResponses } from '../src/responseHistory.js';
import { compactSession, compactMessages, fullSessionMessages } from '../src/sessions.js';
import { refineCompaction } from '../src/semanticCompaction.js';
import { callModel } from '../src/model.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
import type { ModelMessage, SessionRecord } from '../src/types.js';

function fixture(stored: boolean) {
  const config = structuredClone(defaultConfig);
  Object.assign(config.model, { apiProtocol: 'responses', responsesTransport: 'native', endpointUrl: 'http://127.0.0.1:9999/responses', apiKeyEnv: '', responsesStore: stored, thinkingEnabled: false });
  config.hooks = []; config.modelRetry = { maxRetries: 0 };
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 3000 };
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Earlier architecture discussion. '.repeat(1800) },
    { role: 'assistant', content: 'Earlier complete answer. '.repeat(1800) },
    { role: 'user', content: 'Read two fixture files and report their contents.' },
  ];
  const { scope } = responsesRequest(config, 'rules', messages, [], false);
  for (const id of ['one', 'two']) {
    const content = [{ type: 'tool_use' as const, id: 'call_' + id, name: 'read_file', input: { path: id + '.txt' } }];
    const output = [
      { type: 'reasoning', id: 'rs_' + id, summary: [], encrypted_content: 'opaque_' + id },
      { type: 'function_call', id: 'fc_' + id, call_id: 'call_' + id, name: 'read_file', arguments: JSON.stringify({ path: id + '.txt' }), status: 'completed' },
    ];
    messages.push({ role: 'assistant', content, responses: { scope, id: 'resp_' + id, stored, output, prefixHash: responseHistoryHash([...messages, { role: 'assistant', content }]) } });
    messages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_' + id, content: 'contents_' + id }] });
  }
  const session: SessionRecord = { id: 'session_1111111111111111', title: 'fixture', cwd: '.', createdAt: '', updatedAt: '', messages };
  return { config, session };
}

for (const stored of [false, true]) test(`compaction preserves every current-turn native item without reusing old server IDs (stored=${stored})`, async () => {
  const { config, session } = fixture(stored);
  const original = structuredClone(session.messages);
  compactSession(session, 3000, { force: true, model: config.model });
  expect(session.archivedMessages).toEqual(original.slice(0, 2));
  const body = responsesRequest(config, 'new rules', session.messages, [], false).body;
  expect(body.previous_response_id).toBeUndefined();
  expect(body.instructions).toBe('new rules');
  expect(session.messages.slice(1).map(({ role, content }) => ({ role, content }))).toEqual(original.slice(2).map(({ role, content }) => ({ role, content })));
  expect(fullSessionMessages(session).map(({ role, content }) => ({ role, content }))).toEqual(original.map(({ role, content }) => ({ role, content })));
  for (const id of ['one', 'two']) {
    expect((body.input as any[]).find(item => item.id === 'rs_' + id)).toEqual(original.find(message => message.responses?.id === 'resp_' + id)!.responses!.output[0]);
    expect((body.input as any[]).find(item => item.id === 'fc_' + id)).toEqual(original.find(message => message.responses?.id === 'resp_' + id)!.responses!.output[1]);
    expect((body.input as any[]).filter(item => item.type === 'function_call_output' && item.call_id === 'call_' + id)).toHaveLength(1);
  }
  const server = Bun.serve({ port: 0, async fetch(request) {
    const sent = await request.json() as any;
    expect(sent.previous_response_id).toBeUndefined();
    expect(sent.input.filter((item: any) => item.type === 'reasoning')).toHaveLength(2);
    return Response.json({ id: 'resp_after_compact', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'continued' }] }], usage: { input_tokens: 300, output_tokens: 10 } });
  } });
  try {
    // Scope is destination-bound. Rebind the fixture to the server before constructing history.
    const networkFixture = fixture(stored);
    networkFixture.config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`;
    const scope = responsesRequest(networkFixture.config, '', [], [], false).scope;
    for (const message of networkFixture.session.messages) if (message.responses) message.responses.scope = scope;
    compactSession(networkFixture.session, 3000, { force: true });
    const result = await callModel(networkFixture.config, 'rules', networkFixture.session.messages, []);
    expect(result.content[0]?.text).toBe('continued');
    networkFixture.session.messages.push({ role: 'assistant', content: result.content, responses: result.responses! }, { role: 'user', content: 'continue again' });
    const next = responsesRequest(networkFixture.config, 'rules', networkFixture.session.messages, [], false).body;
    expect(next.previous_response_id).toBe(stored ? 'resp_after_compact' : undefined);
  } finally { server.stop(true); }
});

test('compaction cannot bless previously edited history or enable cross-deployment replay', () => {
  const edited = fixture(false); edited.session.messages[0]!.content = 'tampered history';
  compactSession(edited.session, 500, { force: true });
  expect(JSON.stringify(responsesRequest(edited.config, '', edited.session.messages, [], false).body.input)).not.toContain('opaque_');
  const changed = fixture(true); compactSession(changed.session, 3000, { force: true });
  changed.config.model.name += '-other';
  const body = responsesRequest(changed.config, '', changed.session.messages, [], false).body;
  expect(body.previous_response_id).toBeUndefined(); expect(JSON.stringify(body.input)).not.toContain('opaque_');
});

test('rebasing refuses reordered or edited suffixes and does not mutate originals', () => {
  const { session } = fixture(true), before = session.messages, saved = JSON.stringify(before);
  const summary: ModelMessage = { role: 'user', content: '[Earlier conversation summary]\nsummary' };
  const reordered = [summary, ...before.slice(2).reverse()];
  expect(rebaseCompactedResponses(before, reordered)).toBe(reordered);
  const edited = [summary, ...before.slice(2)]; edited[1] = { ...edited[1]!, content: 'edited current prompt' };
  expect(rebaseCompactedResponses(before, edited)).toBe(edited);
  compactSession(session, 3000, { force: true }); expect(JSON.stringify(before)).toBe(saved);
});

test('legacy compactMessages preserves bound native outputs but invalidates old IDs', () => {
  const { config, session } = fixture(true);
  const messages = compactMessages(session.messages, 3000);
  const body = responsesRequest(config, '', messages, [], false).body;
  expect(body.previous_response_id).toBeUndefined();
  expect((body.input as any[]).filter(item => item.type === 'reasoning')).toHaveLength(2);
});

test('semantic summary replacement rebinds only already-valid retained native outputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-072-semantic-')), old = process.env.CCPT_HOME;
  process.env.CCPT_HOME = root;
  const server = Bun.serve({ port: 0, fetch() { return Response.json({ id: 'resp_summary', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Keep architecture. Read fixtures.' }] }], usage: { input_tokens: 100, output_tokens: 8 } }); } });
  try {
    const { config, session } = fixture(true); config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`;
    const scope = responsesRequest(config, '', [], [], false).scope;
    for (const message of session.messages) if (message.responses) message.responses.scope = scope;
    config.contextCompaction = { mode: 'semantic', maxInputTokens: 100000, maxOutputTokens: 400, timeoutMs: 3000 };
    compactSession(session, 5000, { force: true });
    expect(await refineCompaction({ config, session, archiveOffset: 0, persist: async () => {} })).toBe(true);
    expect(session.compaction?.method).toBe('semantic');
    const body = responsesRequest(config, '', session.messages, [], false).body;
    expect(body.previous_response_id).toBeUndefined();
    expect((body.input as any[]).filter(item => item.type === 'reasoning')).toHaveLength(2);
    session.messages[0]!.content += ' arbitrary later edit';
    expect(JSON.stringify(responsesRequest(config, '', session.messages, [], false).body.input)).not.toContain('opaque_');
  } finally {
    server.stop(true); if (old === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = old;
    await removeOwnedTemporaryFixture(root);
  }
});
