import type { UsageRecord, UsageSummary } from '../usage.js';
import { summarizeUsage } from '../usage.js';

export interface AnalyticsDashboard {
  range: { from?: string; to?: string };
  totals: UsageSummary;
  modelShare: Array<{ model: string; records: number; tokens: number; costUsd: number; percent: number }>;
  agentShare: Array<{ agentId: string; records: number; tokens: number; costUsd: number }>;
  dailyTrend: Array<{ day: string; records: number; tokens: number; costUsd: number }>;
  efficiency: { averageTokens: number; averageDurationMs: number; toolsPerTurn: number; cacheHitPercent: number };
}

export function buildAnalyticsDashboard(records: readonly UsageRecord[], range: { from?: string; to?: string } = {}): AnalyticsDashboard {
  const from = range.from ? Date.parse(range.from) : Number.NEGATIVE_INFINITY;
  const to = range.to ? Date.parse(range.to) : Number.POSITIVE_INFINITY;
  const filtered = records.filter((item) => Date.parse(item.createdAt) >= from && Date.parse(item.createdAt) <= to);
  const totals = summarizeUsage(filtered);
  const models = new Map<string, { records: number; tokens: number; costUsd: number }>();
  for (const record of filtered) {
    const item = models.get(record.model) ?? { records: 0, tokens: 0, costUsd: 0 };
    item.records += 1; item.tokens += record.inputTokens + record.outputTokens; item.costUsd += record.costUsd; models.set(record.model, item);
  }
  const allTokens = totals.inputTokens + totals.outputTokens;
  const measured = filtered.filter((item) => item.schemaVersion === 2 && item.inputSource === 'reported');
  const denominator = measured.reduce((sum, item) => sum + item.inputTokens, 0);
  const cacheRead = measured.reduce((sum, item) => sum + item.cacheReadTokens, 0);
  return {
    range: { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) }, totals,
    modelShare: [...models].map(([model, item]) => ({ model, ...item, percent: allTokens ? Math.round(item.tokens / allTokens * 10_000) / 100 : 0 })).sort((a, b) => b.tokens - a.tokens),
    agentShare: Object.entries(totals.byAgent).map(([agentId, item]) => ({ agentId, ...item })).sort((a, b) => b.tokens - a.tokens),
    dailyTrend: Object.entries(totals.byDay).map(([day, item]) => ({ day, ...item })).sort((a, b) => a.day.localeCompare(b.day)),
    efficiency: { averageTokens: totals.records ? Math.round(allTokens / totals.records) : 0, averageDurationMs: totals.records ? Math.round(totals.durationMs / totals.records) : 0, toolsPerTurn: totals.records ? Math.round(totals.toolCalls / totals.records * 100) / 100 : 0, cacheHitPercent: denominator ? Math.min(100, Math.round(cacheRead / denominator * 10_000) / 100) : 0 },
  };
}

export function renderAnalyticsDashboard(dashboard: AnalyticsDashboard, width = 80): string {
  const usable = Math.max(20, width - 28);
  const maximum = Math.max(1, ...dashboard.dailyTrend.map((item) => item.tokens));
  const trend = dashboard.dailyTrend.map((item) => `${item.day} ${'█'.repeat(Math.max(1, Math.round(item.tokens / maximum * usable)))} ${item.tokens}`).join('\n');
  return [`Usage analytics`, `Records ${dashboard.totals.records} · Tokens ${dashboard.totals.inputTokens + dashboard.totals.outputTokens} · Cost ${dashboard.totals.unknownCostRecords ? 'unavailable/incomplete' : `$${dashboard.totals.costUsd.toFixed(4)}`}`, `Reported ${dashboard.totals.reportedTokens} · Estimated ${dashboard.totals.estimatedTokens} · Unknown ${dashboard.totals.unknownTokens}`, `Cache hit ${dashboard.efficiency.cacheHitPercent}% (v2 measured input only) · Tools/turn ${dashboard.efficiency.toolsPerTurn}`, '', trend || 'No usage records in this range.'].join('\n');
}
