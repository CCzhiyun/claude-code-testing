import { expect, test } from 'bun:test';
import { defaultConfig } from '../src/config.js';
import { callModel } from '../src/model.js';
import { estimateTokens, normalizeUsage } from '../src/tokenUsage.js';
import { formatUsageSummary, summarizeUsage, type UsageRecord } from '../src/usage.js';
import { buildAnalyticsDashboard } from '../src/enhancements/analyticsDashboard.js';

test('missing or invalid usage stays unknown; explicit zero is retained', () => {
  for (const raw of [undefined, null, {}, { prompt_tokens: null, completion_tokens: -1 }, { prompt_tokens: '99', completion_tokens: NaN }]) expect(normalizeUsage(raw, 'compatible')).toBeUndefined();
  expect(normalizeUsage({ prompt_tokens: 0 }, 'compatible')).toEqual({ inputTokens: 0 });
  expect(normalizeUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 }, completion_tokens_details: { reasoning_tokens: 10 } }, 'compatible')).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, reasoningTokens:10 });
  expect(normalizeUsage({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 60, cache_creation_input_tokens: 30 }, 'messages')).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 30 });
  expect(estimateTokens('你好世界')).toBeGreaterThan(1);
  expect(estimateTokens('')).toBe(0);
});

test('SSE usage uses final cumulative counts, handles empty choices, preserves missing deltas and requests usage', async () => {
  let mode = 'compatible'; let body: any;
  const server = Bun.serve({ port: 0, async fetch(request) {
    body = await request.json();
    const chunks = mode === 'messages' ? [
      { type: 'message_start', message: { usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 20, cache_creation_input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
      { type: 'message_delta', usage: { output_tokens: 4 } },
      { type: 'message_delta', usage: { output_tokens: 8 } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    ] : [
      { choices: [{ delta: { content: 'Hello' } }], usage: null },
      { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 60 } } },
      { choices: [], usage: { completion_tokens: 20 } },
      { choices: [], usage: null },
    ];
    return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  const config = structuredClone(defaultConfig);
  config.model.provider = 'compatible'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
  try {
    const compatible = await callModel(config, 'system', [], [], {});
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(compatible.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 60 });
    mode = 'messages'; config.model.provider = 'anthropic';
    const messages = await callModel(config, 'system', [], [], {});
    expect(messages.usage).toEqual({ inputTokens: 33, outputTokens: 8, cacheReadTokens: 20, cacheWriteTokens: 10 });
  } finally { server.stop(true); }
});

test('JSON fallback and nonstream paths do not fabricate zero usage', async () => {
  let protocol = 'compatible'; let usage: any;
  const server = Bun.serve({ port: 0, fetch() { return Response.json(protocol === 'compatible' ? { choices: [{ message: { content: 'Done' } }], usage } : { content: [{ type: 'text', text: 'Done' }], usage }); } });
  const config = structuredClone(defaultConfig);
  config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
  try {
    for (const provider of ['compatible', 'anthropic'] as const) {
      protocol = provider; config.model.provider = provider;
      for (const stream of [undefined, {}]) {
        usage = undefined; expect((await callModel(config, '', [], [], stream)).usage).toBeUndefined();
        usage = provider === 'compatible' ? { prompt_tokens: 0, completion_tokens: 0 } : { input_tokens: 0, output_tokens: 0 };
        expect((await callModel(config, '', [], [], stream)).usage).toEqual({ inputTokens: 0, outputTokens: 0 });
      }
    }
  } finally { server.stop(true); }
});

test('usage separates provenance, leaves legacy unchanged and counts cache once', () => {
  const base: UsageRecord = { id: 'a', sessionId: 's', agentId: 'a', model: 'm', inputTokens: 100, outputTokens: 20, cacheReadTokens: 60, cacheWriteTokens: 10, costUsd: 0, durationMs: 100, toolCalls: 1, createdAt: new Date().toISOString() };
  const modern: UsageRecord = { ...base, schemaVersion: 2, inputSource: 'reported', outputSource: 'estimated', costSource: 'unknown' };
  const summary = summarizeUsage([modern, base]);
  expect(summary.inputTokens + summary.outputTokens).toBe(240);
  expect(summary.reportedTokens).toBe(100); expect(summary.estimatedTokens).toBe(20); expect(summary.unknownTokens).toBe(120);
  expect(summary.legacyRecords).toBe(1); expect(formatUsageSummary(summary)).toContain('unavailable');
  expect(buildAnalyticsDashboard([modern]).efficiency.cacheHitPercent).toBe(60);
});
