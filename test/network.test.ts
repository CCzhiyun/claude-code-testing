import { afterAll, describe, expect, test } from 'bun:test';
import { defaultConfig } from './legacyFixtureConfig.js';
import { callModel } from '../src/model.js';
import { networkJson } from '../src/network.js';
import { createServer } from 'node:http';

let lastAnthropicRequest: Record<string, unknown> | undefined;
let lastAnthropicStreamRequest: Record<string, unknown> | undefined;
let lastAnthropicStreamAuthorization: string | null = null;

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/v1/chat/completions') return Response.json({ choices: [{ message: { content: 'local response' }, finish_reason: 'stop' }] });
    if (path === '/custom-model') return Response.json({ choices: [{ message: { content: `${request.headers.get('api-key')}:${request.headers.get('x-team')}` }, finish_reason: 'stop' }] });
    if (path === '/anthropic/v1/messages') {
      const body = await request.json() as { model?: string; tools?: Array<{ name?: string }> };
      lastAnthropicRequest = body as Record<string, unknown>;
      return Response.json({
        content: [
          { type: 'thinking', thinking: 'Inspect the repository before choosing a tool.', signature: 'sig-test' },
          { type: 'text', text: `${request.headers.get('authorization')}:${body.model}` },
          { type: 'tool_use', id: 'tool_1', name: body.tools?.[0]?.name, input: { path: 'README.md' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 7, cache_read_input_tokens: 3 },
      });
    }
    if (path === '/anthropic-stream/v1/messages') {
      lastAnthropicStreamRequest = await request.json() as Record<string, unknown>;
      lastAnthropicStreamAuthorization = request.headers.get('authorization');
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            'event: message_start',
            'data: {"type":"message_start","message":{"usage":{"input_tokens":4}}}',
            '',
            'event: content_block_start',
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
            '',
            'event: content_block_delta',
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello "}}',
            '',
            '',
          ].join('\n')));
          setTimeout(() => {
            controller.enqueue(encoder.encode([
              'event: content_block_delta',
              'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"stream"}}',
              '',
              'event: content_block_stop',
              'data: {"type":"content_block_stop","index":0}',
              '',
              'event: message_delta',
              'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}',
              '',
              'event: message_stop',
              'data: {"type":"message_stop"}',
              '',
              '',
            ].join('\n')));
            controller.close();
          }, 60);
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    }
    return Response.json({ ok: true });
  },
});

afterAll(() => server.stop(true));

describe('enterprise network client', () => {
  test('bypasses configured proxies for loopback services', async () => {
    const config = structuredClone(defaultConfig);
    config.network.proxyUrl = 'http://127.0.0.1:1';
    const response = await networkJson<{ ok: boolean }>(`http://127.0.0.1:${server.port}/health`, {}, config.network);
    expect(response.value.ok).toBe(true);
  });

  test('routes external HTTP requests through the configured proxy', async () => {
    const proxy = createServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ target: request.url }));
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Proxy did not bind');
    const config = structuredClone(defaultConfig);
    config.network.proxyUrl = `http://127.0.0.1:${address.port}`;
    try {
      const response = await networkJson<{ target: string }>('http://service.example.invalid/path?q=1', {}, config.network);
      const routed = new URL(response.value.target);
      expect(routed.hostname).toBe('service.example.invalid');
      expect(`${routed.pathname}${routed.search}`).toBe('/path?q=1');
    } finally {
      await new Promise<void>((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
    }
  });

  test('enforces the enterprise destination allowlist', async () => {
    const config = structuredClone(defaultConfig);
    config.network.allowedHosts = ['models.company.example'];
    const previous = process.env.NO_PROXY;
    process.env.NO_PROXY = '*';
    try { await expect(networkJson('http://unapproved.example.invalid/path', {}, config.network)).rejects.toThrow('not allowlisted'); }
    finally { if (previous === undefined) delete process.env.NO_PROXY; else process.env.NO_PROXY = previous; }
  });

  test('network policy blocks external model endpoints while plan mode can still use loopback model transport', async () => {
    const config = structuredClone(defaultConfig);
    config.policy.allowNetwork = false;
    config.model.baseUrl = 'https://models.example.invalid/v1';
    await expect(callModel(config, 'test', [{ role: 'user', content: 'hello' }], [])).rejects.toThrow('External model network access is disabled');
    config.policy.mode = 'restricted';
    config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
    expect((await callModel(config, 'test', [{ role: 'user', content: 'hello' }], [])).content[0]?.text).toBe('local response');
  });

  test('supports complete enterprise endpoint URLs and environment-backed headers', async () => {
    process.env.CCPT_API_KEY = 'primary-key';
    process.env.CCPT_TEAM_HEADER = 'engineering';
    const config = structuredClone(defaultConfig);
    config.model.endpointUrl = `http://127.0.0.1:${server.port}/custom-model?api-version=1`;
    config.model.apiKeyHeader = 'api-key';
    config.model.apiKeyPrefix = '';
    config.model.headersFromEnvironment = { 'x-team': 'CCPT_TEAM_HEADER' };
    try {
      const response = await callModel(config, 'test', [{ role: 'user', content: 'hello' }], []);
      expect(response.content[0]?.text).toBe('primary-key:engineering');
    } finally {
      delete process.env.CCPT_API_KEY;
      delete process.env.CCPT_TEAM_HEADER;
    }
  });

  test('uses Anthropic Messages protocol and ANTHROPIC_AUTH_TOKEN for Claude-compatible settings', async () => {
    const previous = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_AUTH_TOKEN = 'anthropic-test-token';
    const config = structuredClone(defaultConfig);
    config.model.provider = 'anthropic';
    config.model.name = 'glm-5.2[1m]';
    config.model.baseUrl = `http://127.0.0.1:${server.port}/anthropic`;
    config.model.thinkingEnabled = true;
    try {
      const response = await callModel(config, 'system instructions', [{ role: 'user', content: 'inspect' }], [{ name: 'read_file', description: 'Read a file', input_schema: { type: 'object' } }]);
      expect(response.content[0]).toEqual({ type: 'thinking', text: 'Inspect the repository before choosing a tool.', signature: 'sig-test' });
      expect(response.content[1]?.text).toBe('Bearer anthropic-test-token:glm-5.2');
      expect(response.content[2]).toEqual({ type: 'tool_use', id: 'tool_1', name: 'read_file', input: { path: 'README.md' } });
      expect(response.stopReason).toBe('tool_use');
      expect(response.usage).toEqual({ inputTokens: 15, outputTokens: 7, cacheReadTokens: 3 });
      expect(lastAnthropicRequest).toMatchObject({ model: 'glm-5.2', system: 'system instructions', thinking: { type: 'enabled', budget_tokens: 4096 }, messages: [{ role: 'user', content: 'inspect' }], tools: [{ name: 'read_file' }] });
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previous;
    }
  });

  test('streams Anthropic text deltas before the response has completed', async () => {
    const previous = process.env.ANTHROPIC_AUTH_TOKEN;
    process.env.ANTHROPIC_AUTH_TOKEN = 'stream-test-token';
    const config = structuredClone(defaultConfig);
    config.model.provider = 'anthropic';
    config.model.name = 'glm-5.2[1m]';
    config.model.baseUrl = `http://127.0.0.1:${server.port}/anthropic-stream`;
    const deltas: string[] = [];
    let firstDelta!: () => void;
    const firstDeltaReceived = new Promise<void>((resolve) => { firstDelta = resolve; });
    let completed = false;
    try {
      const pending = callModel(config, 'stream system', [{ role: 'user', content: 'stream' }], [], {
        onTextDelta(delta) { deltas.push(delta); firstDelta(); },
      }).finally(() => { completed = true; });
      await firstDeltaReceived;
      expect(completed).toBe(false);
      expect(deltas).toEqual(['Hello ']);
      const response = await pending;
      expect(response.content).toEqual([{ type: 'text', text: 'Hello stream' }]);
      expect(response.stopReason).toBe('end_turn');
      expect(response.usage).toEqual({ inputTokens: 4, outputTokens: 2 });
      expect(deltas).toEqual(['Hello ', 'stream']);
      expect(lastAnthropicStreamRequest).toMatchObject({ model: 'glm-5.2', stream: true });
      expect(lastAnthropicStreamAuthorization).toBe('Bearer stream-test-token');
    } finally {
      if (previous === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN;
      else process.env.ANTHROPIC_AUTH_TOKEN = previous;
    }
  });
});
