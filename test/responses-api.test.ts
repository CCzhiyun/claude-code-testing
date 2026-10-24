import { expect, test } from 'bun:test';
import { defaultConfig, validateConfig } from '../src/config.js';
import { callModel } from '../src/model.js';
import { apiPresetPatch, resolveModelEndpoint } from '../src/modelConnection.js';
import { responsesRequest } from '../src/responsesModel.js';
import { normalizeUsage } from '../src/tokenUsage.js';
import { estimateContextInput } from '../src/contextBudget.js';
import { configForDisplay } from '../src/configDisplay.js';
import { modelDiagnostics } from '../src/modelDiagnostics.js';
import { responseRecord } from '../src/responseRecords.js';
import { SseDecoder } from '../src/cli/transports/SSETransport.js';
import type { ModelMessage } from '../src/types.js';

const textOutput = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello 你好' }] }];
const completed = (output = textOutput) => ({ id: 'resp_fixture', status: 'completed', output, usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 60 }, output_tokens_details: { reasoning_tokens: 10 } } });
function configuration(endpoint = 'http://127.0.0.1:9999/responses') {
  const config = structuredClone(defaultConfig);
  config.model.apiProtocol = 'responses'; config.model.endpointUrl = endpoint; config.model.name = 'deployment-name';
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
  return config;
}

test('Responses endpoint suffix, exact gateway URL and Azure api-version are preserved', () => {
  for (const base of ['https://resource.example/openai/v1', 'https://gateway.example/responses/v1', 'https://resource.example/openai/v1/responses']) {
    const config = configuration(); delete config.model.endpointUrl; config.model.baseUrl = `${base}?api-version=v1`;
    expect(resolveModelEndpoint(config.model)).toBe(`${base.endsWith('/responses') ? base : `${base}/responses`}?api-version=v1`);
  }
  const config = configuration('https://gateway.example/custom/path?api-version=preview');
  expect(resolveModelEndpoint(config.model)).toBe(config.model.endpointUrl!);
  expect(apiPresetPatch('azure-responses')).toMatchObject({ apiProtocol: 'responses', apiKeyHeader: 'api-key', apiKeyEnv: 'AZURE_OPENAI_API_KEY', responsesStore: false, endpointUrl: '' });
});

test('Responses request supports images, instructions, flat functions, JSON schema and correct limits', () => {
  const config = configuration(); config.model.responsesTextFormat = { type: 'json_schema', name: 'result', strict: true, schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false } };
  validateConfig(config);
  const { body } = responsesRequest(config, 'system rules', [{ role: 'user', content: [{ type: 'text', text: 'Look' }, { type: 'image', data: 'eA==', media_type: 'image/png' }] }], [{ name: 'read', description: 'Read', input_schema: { type: 'object' } }], true);
  expect(body).toMatchObject({ instructions: 'system rules', max_output_tokens: config.model.maxOutputTokens, stream: true, store: false, text: { format: config.model.responsesTextFormat } });
  expect(body).not.toHaveProperty('messages'); expect(body).not.toHaveProperty('max_tokens'); expect(body).not.toHaveProperty('stream_options');
  expect(body.tools).toEqual([{ type: 'function', name: 'read', description: 'Read', parameters: { type: 'object' }, strict: false }]);
  expect(JSON.stringify(body.input)).toContain('input_image'); expect(JSON.stringify(body.input)).toContain('data:image/png;base64,eA==');
});

test('Responses JSON and SSE fallback normalize text and cached usage exactly once', async () => {
  const server = Bun.serve({ port: 0, fetch: () => Response.json(completed()) });
  try {
    for (const streaming of [false, true]) {
      let text = '';
      const result = await callModel(configuration(`http://127.0.0.1:${server.port}/responses`), 'rules', [], [], streaming ? { onTextDelta: delta => { text += delta; } } : undefined);
      expect(result.content).toEqual([{ type: 'text', text: 'Hello 你好' }]);
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, reasoningTokens:10 });
      if (streaming) expect(text).toBe('Hello 你好');
    }
    expect(normalizeUsage({ input_tokens: 0, output_tokens: 0 }, 'responses')).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(normalizeUsage({}, 'responses')).toBeUndefined();
  } finally { server.stop(true); }
});

test('Responses tool roundtrip uses call_id, preserves reasoning and validates continuity before delta-only requests', async () => {
  const output: any = [{ type: 'reasoning', id: 'reason1', summary: [], encrypted_content: 'opaque' }, { type: 'function_call', id: 'item1', call_id: 'call1', name: 'read', arguments: '{"path":"test.txt"}', status: 'completed' }];
  const server = Bun.serve({ port: 0, fetch: () => Response.json(completed(output)) });
  try {
    const config = configuration(`http://127.0.0.1:${server.port}/responses`); config.model.responsesStore = true;
    const history: ModelMessage[] = [{ role: 'user', content: 'read it' }];
    const response = await callModel(config, 'rules', history, []);
    expect(response.content).toEqual([{ type: 'tool_use', id: 'call1', name: 'read', input: { path: 'test.txt' } }]);
    history.push({ role: 'assistant', content: response.content, responses: response.responses! }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call1', content: 'fixture result' }] });
    const next = responsesRequest(config, 'new rules', history, [], false).body;
    expect(next.previous_response_id).toBe('resp_fixture'); expect(next.instructions).toBe('new rules');
    expect(next.input).toEqual([{ type: 'function_call_output', call_id: 'call1', output: 'fixture result' }]);
    config.model.responsesStore = false;
    const replay = responsesRequest(config, '', history, [], false).body;
    expect(replay.previous_response_id).toBeUndefined(); expect(JSON.stringify(replay.input)).toContain('encrypted_content');
    config.model.responsesStore = true;
    history[0]!.content = 'edited/compacted history';
    expect(responsesRequest(config, '', history, [], false).body.previous_response_id).toBeUndefined();
    history[0]!.content = 'read it'; config.model.name = 'new deployment';
    expect(responsesRequest(config, '', history, [], false).body.previous_response_id).toBeUndefined();
    const clean = [{ role: 'assistant' as const, content: response.content }];
    const withMetadata = [{ ...clean[0]!, responses: { ...response.responses!, output: output.filter((x: any) => x.type !== 'reasoning') } }];
    expect(estimateContextInput('', clean, [])).toBe(estimateContextInput('', withMetadata, []));
  } finally { server.stop(true); }
});

test('SSE split CRLF frames and Chinese UTF-8 bytes do not corrupt output or duplicate final text', async () => {
  const decoder = new SseDecoder(); expect(decoder.push('data: {"x":1}\r')).toEqual([]);
  expect(decoder.push('\n\r')).toEqual([]); expect(decoder.push('\n')).toHaveLength(1);
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'Hello 你好' })}\r\n\r\ndata: ${JSON.stringify({ type: 'response.completed', response: completed() })}\r\n\r\n`);
  const split = bytes.indexOf(0xe4) + 1;
  const server = Bun.serve({ port: 0, fetch() { return new Response(new ReadableStream({ async start(controller) { controller.enqueue(bytes.slice(0, split)); await Bun.sleep(10); controller.enqueue(bytes.slice(split)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } }); } });
  try {
    let text = ''; const response = await callModel(configuration(`http://127.0.0.1:${server.port}`), '', [], [], { onTextDelta: delta => { text += delta; } });
    expect(text).toBe('Hello 你好'); expect(response.content[0]?.text).toBe(text);
  } finally { server.stop(true); }
});

test('failed, incomplete, truncated SSE and malformed function arguments never yield executable tools', async () => {
  let body: any = { ...completed(), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } };
  let sse = false;
  const server = Bun.serve({ port: 0, fetch: () => sse ? new Response('data: {"type":"response.output_item.added","item":{"type":"function_call","call_id":"x","name":"shell"}}\n\n') : Response.json(body) });
  try {
    const config = configuration(`http://127.0.0.1:${server.port}`);
    await expect(callModel(config, '', [], [])).rejects.toThrow('did not complete');
    body = { ...completed(), status: 'failed', error: { message: 'no' } }; await expect(callModel(config, '', [], [])).rejects.toThrow();
    body = completed([{ type: 'function_call', call_id: 'call1', name: 'shell', arguments: '{broken' }] as any); await expect(callModel(config, '', [], [])).rejects.toThrow('arguments JSON');
    body = completed([{ type: 'function_call', call_id: 'call1', name: 'shell', arguments: '[]' }] as any); await expect(callModel(config, '', [], [])).rejects.toThrow('must be an object');
    sse = true; await expect(callModel(config, '', [], [], {})).rejects.toThrow('without response.completed');
  } finally { server.stop(true); }
});

test('expired previous_response_id retries exactly once with full stateless history, never on auth failures', async () => {
  const bodies: any[] = []; let status = 404;
  const server = Bun.serve({ port: 0, async fetch(request) { const body: any = await request.json(); bodies.push(body); return body.previous_response_id ? Response.json({ error: { param: 'previous_response_id', code: 'previous_response_not_found' } }, { status }) : Response.json(completed()); } });
  try {
    const config = configuration(`http://127.0.0.1:${server.port}`); config.model.responsesStore = true;
    const history: ModelMessage[] = [{ role: 'user', content: 'hi' }]; const first = await callModel(config, '', history, []);
    history.push({ role: 'assistant', content: first.content, responses: first.responses! }, { role: 'user', content: 'continue' });
    const result = await callModel(config, 'rules', history, []);
    expect(bodies).toHaveLength(3); expect(bodies[1].previous_response_id).toBeDefined(); expect(bodies[2].previous_response_id).toBeUndefined(); expect(bodies[2].store).toBe(false); expect(result.responses?.stored).toBe(false);
    status = 401; await expect(callModel(config, '', history, [])).rejects.toThrow(); expect(bodies).toHaveLength(4);
  } finally { server.stop(true); }
});

test('response record management validates IDs and preserves endpoint query', async () => {
  const received: string[] = [];
  const server = Bun.serve({ port: 0, fetch(request) { received.push(`${request.method} ${new URL(request.url).pathname}${new URL(request.url).search}`); return Response.json({ id: 'resp_1', deleted: request.method === 'DELETE' }); } });
  try {
    const config = configuration(`http://127.0.0.1:${server.port}/responses/v1/responses?api-version=v1`);
    await responseRecord(config, 'resp_1', 'GET'); await responseRecord(config, 'resp_1', 'DELETE');
    expect(received).toEqual(['GET /responses/v1/responses/resp_1?api-version=v1', 'DELETE /responses/v1/responses/resp_1?api-version=v1']);
    await expect(responseRecord(config, '../all', 'DELETE')).rejects.toThrow('Invalid response');
    expect(received).toHaveLength(2);
  } finally { server.stop(true); }
});

test('settings diagnostics redact secrets without hiding numeric token limits or modifying originals', async () => {
  const fixture = { env: { COMPANY_VALUE: 'secret-in-env' }, model: { maxContextTokens: 100000, apiKeyEnv: 'COMPANY_MODEL_KEY', endpointUrl: 'https://user:pw@example.test/responses?key=hidden&api-version=v1' }, apiKey: 'secret-key' };
  const snapshot = JSON.stringify(fixture); const safe = configForDisplay(fixture) as any;
  expect(safe.model.maxContextTokens).toBe(100000); expect(safe.model.apiKeyEnv).toBe('COMPANY_MODEL_KEY');
  for (const secret of ['secret-in-env', 'user:pw', 'key=hidden', 'secret-key']) expect(JSON.stringify(safe)).not.toContain(secret);
  expect(JSON.stringify(fixture)).toBe(snapshot);
  const config = configuration(); config.model.baseUrl = ''; config.model.apiKeyEnv = 'CCPT_TEST_MISSING_RESPONSES_KEY_54321';
  const checks = await modelDiagnostics(config);
  expect(checks.find(x => x.check === 'model endpoint')?.ok).toBe(true);
  expect(checks.find(x => x.check === 'model credential')?.ok).toBe(false);
});
