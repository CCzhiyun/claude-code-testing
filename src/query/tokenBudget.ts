const COMPLETION_THRESHOLD = 0.9;
const DIMINISHING_THRESHOLD = 500;

export interface BudgetTracker {
  continuationCount: number;
  lastDeltaTokens: number;
  lastGlobalTurnTokens: number;
  startedAt: number;
}

export type TokenBudgetDecision =
  | { action: 'continue'; nudgeMessage: string; continuationCount: number; pct: number; turnTokens: number; budget: number }
  | { action: 'stop'; completionEvent: { continuationCount: number; pct: number; turnTokens: number; budget: number; diminishingReturns: boolean; durationMs: number } | null };

export function createBudgetTracker(): BudgetTracker {
  return { continuationCount: 0, lastDeltaTokens: 0, lastGlobalTurnTokens: 0, startedAt: Date.now() };
}

export function checkTokenBudget(tracker: BudgetTracker, nestedAgentId: string | undefined, budget: number | null, globalTurnTokens: number): TokenBudgetDecision {
  if (nestedAgentId || budget === null || budget <= 0) return { action: 'stop', completionEvent: null };
  const pct = Math.round((globalTurnTokens / budget) * 100);
  const delta = globalTurnTokens - tracker.lastGlobalTurnTokens;
  const diminishing = tracker.continuationCount >= 3 && delta < DIMINISHING_THRESHOLD && tracker.lastDeltaTokens < DIMINISHING_THRESHOLD;
  if (!diminishing && globalTurnTokens < budget * COMPLETION_THRESHOLD) {
    tracker.continuationCount += 1;
    tracker.lastDeltaTokens = delta;
    tracker.lastGlobalTurnTokens = globalTurnTokens;
    return {
      action: 'continue',
      nudgeMessage: `Continue toward the requested outcome. Approximately ${pct}% of the ${budget}-token work budget has been used.`,
      continuationCount: tracker.continuationCount,
      pct,
      turnTokens: globalTurnTokens,
      budget,
    };
  }
  return {
    action: 'stop',
    completionEvent: tracker.continuationCount > 0 || diminishing
      ? { continuationCount: tracker.continuationCount, pct, turnTokens: globalTurnTokens, budget, diminishingReturns: diminishing, durationMs: Date.now() - tracker.startedAt }
      : null,
  };
}
