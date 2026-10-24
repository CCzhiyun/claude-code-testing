import { test, expect } from 'bun:test';
import { defaultConfig } from '../src/config.js';
import { callModel } from '../src/model.js';
import { modelRequestError, retryAfterDelay, ModelRequestError } from '../src/modelErrors.js';
import { withExecutionSignal } from '../src/executionControl.js';
import { withModelRetry } from '../src/modelRetry.js';

test('Retry-After accepts seconds, dates and Azure millisecond headers', () => {
  expect(retryAfterDelay({ 'retry-after': '1.5' })).toBe(1500);
  expect(retryAfterDelay({ 'retry-after-ms': '120', 'retry-after': '5' })).toBe(120);
  expect(retryAfterDelay({ 'x-ms-retry-after-ms': '150' })).toBe(150);
  expect(retryAfterDelay({ 'retry-after': 'Thu, 01 Jan 1970 00:00:10 GMT' }, 5000)).toBe(5000);
  expect(retryAfterDelay({ 'retry-after': 'invalid' })).toBeUndefined();
  expect((modelRequestError(429, { error: { code: 'insufficient_quota' } }) as ModelRequestError).retryable).toBe(false);
  expect((modelRequestError(429, { error: { type: 'rate_limit_error', details: { error_code: 'enforced_spend_limit_reached' } } }) as ModelRequestError).retryable).toBe(false);
});

test('all model protocols honor 429 Retry-After and surface a retry notice', async () => {
  for (const protocol of ['messages', 'chat-completions', 'responses'] as const) {
    let calls = 0; const times: number[] = [], notices: unknown[] = [];
    const server = Bun.serve({ port: 0, fetch() {
      times.push(Date.now());
      if (++calls === 1) return Response.json({ error: { type: 'rate_limit_error', message: 'TPM exceeded' } }, { status: 429, headers: { 'retry-after': '0.05' } });
      return Response.json(protocol === 'messages' ? { content: [{ type: 'text', text: 'recovered' }], stop_reason: 'end_turn' }
        : protocol === 'responses' ? { id: 'resp_ok', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'recovered' }] }] }
          : { choices: [{ message: { content: 'recovered' }, finish_reason: 'stop' }] });
    } });
    try {
      const config = structuredClone(defaultConfig); config.model.apiProtocol = protocol; config.model.endpointUrl = `http://127.0.0.1:${server.port}`;
      config.modelRetry = { maxRetries: 2, baseDelayMs: 1, maxWaitMs: 2000 };
      const response = await callModel(config, 'test', [{ role: 'user', content: 'hello' }], [], { onRetry(notice) { notices.push(notice); } });
      expect(response.content[0]?.text).toBe('recovered'); expect(calls).toBe(2); expect(notices).toHaveLength(1); expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(45);
    } finally { server.stop(true); }
  }
});

test('long server delays are not shortened and quota failures are not retried', async () => {
  const config = structuredClone(defaultConfig); config.modelRetry = { maxRetries: 3, maxWaitMs: 100, baseDelayMs: 1 };
  let calls = 0;
  await expect(withModelRetry(config, '', [], [], undefined, async () => { calls++; throw modelRequestError(429, {}, { 'retry-after': '3600' }); })).rejects.toThrow('wait budget');
  expect(calls).toBe(1);
  await expect(withModelRetry(config, '', [], [], undefined, async () => { calls++; throw modelRequestError(429, { error: { code: 'insufficient_quota' } }); })).rejects.toThrow('quota');
  expect(calls).toBe(2);
});

test('cancel interrupts retry sleep and partial streams never replay', async () => {
  const config = structuredClone(defaultConfig); const controller = new AbortController(); let calls = 0;
  await expect(withExecutionSignal(controller.signal, () => withModelRetry(config, '', [], [], { onRetry() { controller.abort(); } }, async () => { calls++; throw modelRequestError(429, {}, { 'retry-after': '60' }); }))).rejects.toThrow();
  expect(calls).toBe(1);
  await expect(withModelRetry(config, '', [], [], { onTextDelta() {} }, async (stream) => { calls++; stream?.onTextDelta?.('partial'); throw modelRequestError(529, {}); })).rejects.toThrow('not replayed');
  expect(calls).toBe(2);
});

test('shared local RPM/TPM pacing refuses oversized requests and reserves concurrent slots', async () => {
  const config = structuredClone(defaultConfig); config.model.endpointUrl = `http://127.0.0.1:1/${crypto.randomUUID()}`; config.modelRetry = { tokensPerMinute: 1, maxWaitMs: 10 };
  let calls = 0; const operation = async () => { calls++; return { content: [] }; };
  await expect(withModelRetry(config, '', [], [], undefined, operation)).rejects.toThrow('TPM'); expect(calls).toBe(0);
  config.modelRetry = { requestsPerMinute: 1, maxWaitMs: 10 };
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => withModelRetry(config, '', [], [], undefined, operation)));
  expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1); expect(calls).toBe(1);
});
