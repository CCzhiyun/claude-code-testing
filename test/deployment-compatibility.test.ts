import { expect, test } from 'bun:test';
import { defaultConfig, validateConfig } from './legacyFixtureConfig.js';
import { callModel } from '../src/model.js';
import { chatReasoningFields } from '../src/modelCapabilities.js';
import { resolveModelEndpoint } from '../src/modelConnection.js';
import { ModelRequestError, modelRequestError, withModelDiagnosticSecrets } from '../src/modelErrors.js';
import { validateToolSchemas } from '../src/toolSchema.js';
import { tools } from '../src/tooling.js';
import { probeModel } from '../src/modelProbe.js';
import { navigateConfig, type ConfigDialogFacts, type ConfigDialogState } from '../src/components/commandDialogs.js';

test('terminal settings cycles explicit deployment policy without changing the live endpoint', () => {
  const config = structuredClone(defaultConfig);
  const facts: ConfigDialogFacts = { cwd: '.', version: 'test', plugins: 0, skills: 0, agents: 0, activeAgents: 0, tasks: 0, sessionMessages: 0, estimatedTokens: 0 };
  const state: ConfigDialogState = { type: 'config', tab: 'Settings', query: 'Chat tools: reasoning compatibility', selected: 0, scroll: 0, focus: 'rows' };
  for (const policy of ['none', 'omit', 'responses-only', 'preserve'] as const) {
    navigateConfig(state, config, facts, 'space', ' ');
    expect(state.draft?.model?.chatToolReasoning).toBe(policy);
  }
  expect(config.model.chatToolReasoning).toBeUndefined(); expect(state.draft?.model?.endpointUrl).toBeUndefined();
});

test('entire built-in catalog is portable; array items are checked recursively without mutation', () => {
  const before = JSON.stringify(tools);
  expect(tools.length).toBeGreaterThan(70);
  expect(() => validateToolSchemas(tools)).not.toThrow();
  expect(JSON.stringify(tools)).toBe(before);
  for (const name of ['todo_write', 'workflow']) {
    const schema = tools.find((t) => t.name === name)!.input_schema as any;
    const item = schema.properties[name === 'workflow' ? 'tasks' : 'todos'].items;
    expect(item.type).toBe('object'); expect(item.required).toContain(name === 'workflow' ? 'id' : 'title');
  }
  expect(() => validateToolSchemas([{ name: 'broken', description: '', input_schema: { type: 'object', properties: { nested: { type: 'array' } } } }])).toThrow('broken.properties.nested');
});

test('deployment policy distinguishes omitted reasoning, explicit none, supported, and Responses-only', () => {
  const model = { ...defaultConfig.model, thinkingEnabled: true, reasoningEffort: 'high' as const };
  expect(chatReasoningFields({ ...model, chatToolReasoning: 'none' }, 1)).toEqual({ reasoning_effort: 'none' });
  expect(chatReasoningFields({ ...model, thinkingEnabled: false, chatToolReasoning: 'none' }, 1)).toEqual({ reasoning_effort: 'none' });
  expect(chatReasoningFields({ ...model, chatToolReasoning: 'omit' }, 1)).toEqual({});
  expect(chatReasoningFields({ ...model, chatToolReasoning: 'preserve' }, 1)).toEqual({ reasoning_effort: 'high' });
  expect(chatReasoningFields({ ...model, chatToolReasoning: 'none' }, 0)).toEqual({ reasoning_effort: 'high' });
  expect(() => chatReasoningFields({ ...model, chatToolReasoning: 'responses-only' }, 1)).toThrow('requires Responses');
  expect(() => validateConfig({ ...defaultConfig, model: { ...model, chatToolReasoning: 'guess' as any } })).toThrow('chatToolReasoning');
  expect(() => resolveModelEndpoint({ ...model, apiProtocol: 'responses', endpointUrl: 'https://example.com/v1/chat/completions' })).toThrow('route');
  expect(() => resolveModelEndpoint({ ...model, apiProtocol: 'chat-completions', endpointUrl: 'https://example.com/v1/responses' })).toThrow('route');
});

test('JSON and SSE Chat requests apply none without dropping any tools; Responses preserves reasoning', async () => {
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body: any = await request.json(); requests.push(body);
    if (request.url.endsWith('/responses')) return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] });
    if (body.tools?.length && body.reasoning_effort !== 'none') return Response.json({ error: 'Function tools with reasoning_effort are not supported' }, { status: 400 });
    return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  } });
  const config = structuredClone(defaultConfig);
  config.model.apiProtocol = 'chat-completions'; config.model.chatToolReasoning = 'none'; config.model.thinkingEnabled = true;
  config.model.endpointUrl = `http://127.0.0.1:${server.port}/chat/completions`; config.network.proxyUrl = '';
  try {
    for (const stream of [undefined, { onTextDelta() {} }]) {
      await callModel(config, 'test', [{ role: 'user', content: 'Explain your capabilities' }], tools, stream);
      expect(requests.at(-1).tools).toHaveLength(tools.length); expect(requests.at(-1).reasoning_effort).toBe('none');
    }
    config.model.chatToolReasoning = 'responses-only';
    await expect(callModel(config, 'test', [], tools)).rejects.toThrow('requires Responses'); expect(requests).toHaveLength(2);
    config.model.apiProtocol = 'responses'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`;
    await callModel(config, 'test', [{ role: 'user', content: 'Use your tools' }], tools);
    expect(requests.at(-1).reasoning).toEqual({ effort: 'high' }); expect(requests.at(-1).messages).toBeUndefined();
    expect(requests.at(-1).tools[0].function).toBeUndefined(); expect(requests.at(-1).tools).toHaveLength(tools.length);
  } finally { server.stop(true); }
});

test('diagnostics preserve string/object errors, code, param, request ID and redact secrets/control characters', () => {
  const stringError = modelRequestError(400, { error: 'Invalid array: items missing' });
  expect(stringError.message).toContain('Invalid array: items missing');
  const error = withModelDiagnosticSecrets(['custom-header-secret'], () => modelRequestError(400, {
    error: { message: 'Unsupported tools. custom-header-secret api-key=abc123 Bearer xyz123 https://user:pw@example.com/v1?sig=sensitive\u001b[2J', code: 'invalid_request', param: 'reasoning_effort' },
  }, { 'APIM-Request-Id': 'req-123' })) as ModelRequestError;
  expect(error.diagnostics).toMatchObject({ code: 'invalid_request', param: 'reasoning_effort', requestId: 'req-123' });
  expect(error.message).toContain('request-id=req-123');
  for (const secret of ['custom-header-secret', 'abc123', 'xyz123', 'user:pw', 'sensitive', '\u001b']) expect(JSON.stringify(error)).not.toContain(secret);
  expect(modelRequestError(400, { error: { message: 'overloaded', status: 503 } }, {}, true)).toMatchObject({ status: 503 });
  expect(modelRequestError(400, { error: { message: 'invalid', status: 503 } })).toMatchObject({ status: 400 });
});

test('HTTP plain text, HTTP-200 JSON errors and SSE errors expose sanitized metadata with header IDs', async () => {
  let mode = 'text';
  const server = Bun.serve({ port: 0, fetch() {
    const error = { error: { message: 'Unsupported tools; api-key=do-not-log', code: 'invalid_request_error', param: 'tools' } };
    const headers = { 'x-request-id': 'req-wire' };
    if (mode === 'text') return new Response('Unsupported tools; api-key=do-not-log', { status: 400, headers });
    if (mode === 'json') return Response.json(error, { headers });
    return new Response(`data: ${JSON.stringify(error)}\n\n`, { headers: { ...headers, 'content-type': 'text/event-stream' } });
  } });
  const config = structuredClone(defaultConfig); config.network.proxyUrl = ''; config.modelRetry = { maxRetries: 0 };
  config.model.endpointUrl = `http://127.0.0.1:${server.port}/chat/completions`;
  try {
    for (mode of ['text', 'json', 'sse']) {
      let caught: any;
      try { await callModel(config, '', [{ role: 'user', content: 'test' }], [], mode === 'sse' ? {} : undefined); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(ModelRequestError); expect(caught.message).toContain('Unsupported tools');
      expect(caught.message).not.toContain('do-not-log'); expect(caught.diagnostics.requestId).toBe('req-wire');
      if (mode !== 'text') expect(caught.diagnostics.param).toBe('tools');
    }
  } finally { server.stop(true); }
});

test('full catalog probe registers all tools but executes only echo and retains catalog on followup', async () => {
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body: any = await request.json(); requests.push(body);
    return Response.json({ choices: [{ message: requests.length === 1 ? { tool_calls: [{ id: 'echo', function: { name: 'ccpt_probe_echo', arguments: '{"value":"CCPT_OK"}' } }] } : { content: 'CCPT_OK' }, finish_reason: 'stop' }] });
  } });
  const config = structuredClone(defaultConfig); config.model.endpointUrl = `http://127.0.0.1:${server.port}/chat/completions`; config.model.chatToolReasoning = 'none'; config.network.proxyUrl = '';
  try {
    const report = await probeModel(config, { fullToolsCheck: true, stream: true });
    expect(report).toMatchObject({ ok: true, toolRoundTrip: true, catalogToolCount: tools.length + 1 });
    for (const body of requests) { expect(body.tools).toHaveLength(tools.length + 1); expect(body.reasoning_effort).toBe('none'); }
    expect(requests[1].messages).toContainEqual({ role: 'tool', tool_call_id: 'echo', content: 'CCPT_OK' });
  } finally { server.stop(true); }
});
