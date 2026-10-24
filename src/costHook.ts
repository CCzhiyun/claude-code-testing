import { audit } from './audit.js';
import type { CostTracker, TokenRates, Usage } from './cost-tracker.js';
export async function recordModelCost(tracker: CostTracker, usage: Usage, rates: TokenRates, sessionId?: string): Promise<number> { const cost = tracker.add(usage, rates); await audit({ event: 'ModelCost', outcome: 'success', ...(sessionId ? { sessionId } : {}), details: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: cost } }); return cost; }
