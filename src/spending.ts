import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { lstat } from 'node:fs/promises';
import { homeStateDir } from './paths.js';
import { readJson, withFileLock, writeJson } from './storage.js';
import type { PlatformConfig } from './types.js';
import type { ModelResponse } from './model.js';
import { ModelRequestError } from './modelErrors.js';

export interface SpendingPolicy {
  /** Explicit local account, shared across sessions and independent CLI processes. */
  account?: string;
  maxRequests?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  prices?: Record<string, { inputPerMillion: number; outputPerMillion: number }>;
}
export interface SpendingLedger {
  scope: string; requests: number; tokens: number; costUsd: number;
  reservations: Record<string, { tokens: number; costUsd: number; model: string }>;
}
export class BudgetLimitError extends Error {
  constructor(message: string) { super(message); this.name = 'BudgetLimitError'; }
}
export function isBudgetLimitFailure(error: unknown): boolean {
  for (let depth = 0; depth < 8 && error instanceof Error; depth++, error = error.cause) if (error instanceof BudgetLimitError) return true;
  return false;
}
const scopeStorage = new AsyncLocalStorage<string>();
const processScope = `process-${randomUUID()}`;
const accountHome = new AsyncLocalStorage<string>();
export function withBudgetHome<T>(action: () => T): T { return accountHome.run(accountHome.getStore() ?? homeStateDir(), action); }
export function withSpendScope<T>(scope: string, action: () => T): T { return scopeStorage.run(scopeStorage.getStore() ?? scope, action); }
/** Inspect the inherited ledger without creating an independent budget that could bypass it. */
export function currentSpendScope(): string | undefined { return scopeStorage.getStore(); }
const ledgerPath = (scope: string): string => join(scope.startsWith('account:') ? accountHome.getStore() ?? homeStateDir() : homeStateDir(), 'budgets', `${createHash('sha256').update(scope).digest('hex')}.json`);
const nonnegative = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
async function readLedger(scope: string, path: string): Promise<SpendingLedger> {
  for (const target of [join(path, '..'), path]) try { const info = await lstat(target); if (info.isSymbolicLink() || target === path && (!info.isFile() || info.size > 4*1024*1024)) throw new Error('Invalid budget state file'); } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const ledger = await readJson<SpendingLedger>(path, { scope, requests: 0, tokens: 0, costUsd: 0, reservations: {} });
  if (!ledger || ledger.scope !== scope || !Number.isSafeInteger(ledger.requests) || ledger.requests < 0 || !Number.isSafeInteger(ledger.tokens) || ledger.tokens < 0 || !nonnegative(ledger.costUsd) || !ledger.reservations || typeof ledger.reservations !== 'object' || Array.isArray(ledger.reservations) || Object.keys(ledger.reservations).length > 10000 || Object.entries(ledger.reservations).some(([id,r]) => !/^[a-f0-9-]{36}$/.test(id) || !r || !Number.isSafeInteger(r.tokens) || r.tokens < 0 || !nonnegative(r.costUsd) || typeof r.model !== 'string')) throw new Error('Corrupt budget ledger; inspect state, never reset or replay automatically');
  return ledger;
}
export async function readSpending(scope: string): Promise<SpendingLedger> { return readLedger(scope, ledgerPath(scope)); }

export function validateSpending(policy: SpendingPolicy | undefined): void {
  if (policy === undefined) return;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error('spending must be an object');
  if (policy.account !== undefined && (typeof policy.account !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(policy.account) || ['constructor','prototype','__proto__'].includes(policy.account))) throw new Error('spending.account must be a safe local account name');
  for (const key of ['maxRequests', 'maxTokens', 'maxCostUsd'] as const) {
    const value = policy[key];
    if (value !== undefined && (!Number.isFinite(value) || value <= 0 || key !== 'maxCostUsd' && !Number.isSafeInteger(value))) throw new Error(`spending.${key} must be positive${key === 'maxCostUsd' ? '' : ' and a safe integer'}`);
  }
  if (policy.prices !== undefined && (!policy.prices || typeof policy.prices !== 'object' || Array.isArray(policy.prices) || Object.values(policy.prices).some((price) => !price || !Number.isFinite(price.inputPerMillion) || price.inputPerMillion < 0 || !Number.isFinite(price.outputPerMillion) || price.outputPerMillion < 0))) throw new Error('spending.prices requires nonnegative inputPerMillion/outputPerMillion rates');
}

/** Cross-process reservation prevents concurrent teammates from each spending the same remainder. */
export async function withModelBudget(config: PlatformConfig, request: () => Promise<ModelResponse>): Promise<ModelResponse> {
  const policy = config.spending;
  if (!policy) return request();
  validateSpending(policy);
  const scope = scopeStorage.getStore() ?? processScope;
  const scopes = [...new Set([scope, ...(policy.account ? [`account:${policy.account}`] : [])])].sort();
  // Resolve once: ephemeral sessions must not redirect a named account mid-flight.
  const entries = scopes.map(scope => ({scope, path: ledgerPath(scope)}));
  const locked = async <T>(action: () => Promise<T>, index = 0): Promise<T> => index === entries.length ? action() : withFileLock(`${entries[index]!.path}.lock`, () => locked(action, index + 1));
  const id = randomUUID();
  const price = policy.prices?.[config.model.name];
  if (policy.maxCostUsd !== undefined && !price) throw new BudgetLimitError(`No configured price for ${config.model.name}; cost-limited requests are blocked. Configure spending.prices before continuing this session.`);
  // A character estimate is not a safe cost reservation. Reserve the configured
  // input window and maximum output, then reconcile only reported provider usage.
  const tokens = config.model.maxContextTokens + config.model.maxOutputTokens;
  const costUsd = price ? (config.model.maxContextTokens * price.inputPerMillion + config.model.maxOutputTokens * price.outputPerMillion) / 1_000_000 : 0;
  await locked(async () => {
   const ledgers = await Promise.all(entries.map(entry => readLedger(entry.scope, entry.path)));
   for (const ledger of ledgers) {
    const reserved = Object.values(ledger.reservations);
    const totalTokens = ledger.tokens + reserved.reduce((sum, item) => sum + item.tokens, 0);
    const totalCost = ledger.costUsd + reserved.reduce((sum, item) => sum + item.costUsd, 0);
    if (!Number.isSafeInteger(ledger.requests + 1) || !Number.isSafeInteger(totalTokens + tokens) || !nonnegative(totalCost + costUsd)) throw new BudgetLimitError('Budget counters exceed safe bounds; inspect state before continuing');
    const message = 'Session budget cannot safely fund the next model request. Conversation and workspace are preserved; adjust the configured budget to continue.';
    if (policy.maxRequests !== undefined && ledger.requests >= policy.maxRequests || policy.maxTokens !== undefined && totalTokens + tokens > policy.maxTokens || policy.maxCostUsd !== undefined && totalCost + costUsd > policy.maxCostUsd + 1e-10) throw new BudgetLimitError(message);
    if (Object.keys(ledger.reservations).length >= 9999) throw new BudgetLimitError('Unreconciled budget reservations require inspection');
   }
   for (const [index, ledger] of ledgers.entries()) {
    ledger.requests++;
    ledger.reservations[id] = { tokens, costUsd, model: config.model.name };
    await writeJson(entries[index]!.path, ledger);
   }
  });
  // Failure/cancellation retains the reservation: absence of usage does not prove
  // that the provider did not bill. No automatic refund of unknown expenditure.
  let response: ModelResponse;
  try { response = await request(); }
  catch (error) {
    if (error instanceof ModelRequestError && error.rejectedBeforeGeneration) await locked(async () => {
      for (const entry of entries) { const ledger = await readLedger(entry.scope, entry.path); delete ledger.reservations[id]; await writeJson(entry.path, ledger); }
    });
    throw error;
  }
  const usage = response.usage;
  if (usage?.inputTokens !== undefined && usage.outputTokens !== undefined) {
    if (!Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) throw new Error('Invalid provider usage; budget reservations retained');
    const actualCost = price ? (usage.inputTokens * price.inputPerMillion + usage.outputTokens * price.outputPerMillion) / 1_000_000 : 0;
    await locked(async () => {
     for (const entry of entries) {
      const ledger = await readLedger(entry.scope, entry.path);
      if (!ledger.reservations[id]) throw new Error('Budget reservation disappeared during reconciliation');
      delete ledger.reservations[id];
      ledger.tokens += usage.inputTokens! + usage.outputTokens!;
      ledger.costUsd += actualCost;
      if (!Number.isSafeInteger(ledger.tokens) || !nonnegative(ledger.costUsd)) throw new Error('Budget reconciliation overflow; reservation retained');
      await writeJson(entry.path, ledger);
     }
    });
    if (price) response.costUsd = actualCost;
  }
  return response;
}
