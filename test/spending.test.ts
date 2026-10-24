import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { defaultConfig, validateConfig } from '../src/config.js';
import { readSpending, withModelBudget, withSpendScope } from '../src/spending.js';
import type { ModelResponse } from '../src/model.js';

const reply = async (): Promise<ModelResponse> => ({ content: [{ type: 'text', text: 'done' }], usage: { inputTokens: 100, outputTokens: 20 } });
test('a shared request cap is atomic across concurrent teammates', async () => {
  const config = structuredClone(defaultConfig); config.spending = { maxRequests: 1 };
  const scope = randomUUID(); let calls = 0;
  const results = await withSpendScope(scope, () => Promise.allSettled(Array.from({ length: 5 }, () => withModelBudget(config, async () => { calls++; return reply(); }))));
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(calls).toBe(1);
  expect((await readSpending(scope)).tokens).toBe(120);
});
test('cost reservations reconcile reported usage using configured prices', async () => {
  const config = structuredClone(defaultConfig); config.model.maxContextTokens = 1000; config.model.maxOutputTokens = 100;
  config.spending = { maxCostUsd: 1, prices: { [config.model.name]: { inputPerMillion: 2, outputPerMillion: 10 } } };
  const scope = randomUUID();
  const response = await withSpendScope(scope, () => withModelBudget(config, reply));
  expect(response.costUsd).toBeCloseTo(0.0004);
  expect((await readSpending(scope)).costUsd).toBeCloseTo(0.0004);
  expect((await readSpending(scope)).reservations).toEqual({});
});
test('unknown usage and failed requests retain reservations, not free retries', async () => {
  const config = structuredClone(defaultConfig); config.model.maxContextTokens = 1000; config.model.maxOutputTokens = 100; config.spending = { maxTokens: 1100 };
  const scope = randomUUID();
  await expect(withSpendScope(scope, () => withModelBudget(config, async () => { throw new Error('connection lost'); }))).rejects.toThrow('connection lost');
  expect(Object.keys((await readSpending(scope)).reservations)).toHaveLength(1);
  await expect(withSpendScope(scope, () => withModelBudget(config, reply))).rejects.toThrow('budget');
  const other = randomUUID();
  await withSpendScope(other, () => withModelBudget(config, async () => ({ content: [] })));
  expect(Object.keys((await readSpending(other)).reservations)).toHaveLength(1);
});
test('missing model prices fail closed and nested scopes cannot evade parent caps', async () => {
  const config = structuredClone(defaultConfig); config.spending = { maxCostUsd: 2 };
  await expect(withModelBudget(config, reply)).rejects.toThrow('No configured price');
  config.spending = { maxRequests: 1 };
  const scope = randomUUID();
  await withSpendScope(scope, () => withSpendScope('nested', () => withModelBudget(config, reply)));
  await expect(withSpendScope(scope, () => withSpendScope('another', () => withModelBudget(config, reply)))).rejects.toThrow('budget');
  config.spending = { maxCostUsd: Number.NaN };
  expect(() => validateConfig(config)).toThrow('spending');
});
