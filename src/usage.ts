import { join } from 'node:path';
import { homeStateDir } from './paths.js';
import { createId, readJson, withFileLock, writeJson } from './storage.js';
import type { TokenSource } from './tokenUsage.js';
export interface UsageRecord { schemaVersion?: 2; inputSource?: TokenSource; outputSource?: TokenSource; costSource?: TokenSource; id: string; sessionId: string; agentId: string; model: string; inputTokens: number; outputTokens: number; reasoningTokens?: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; durationMs: number; toolCalls: number; createdAt: string }
export interface UsageSummary { records: number; inputTokens: number; outputTokens: number; reasoningTokens: number; reasoningReportedRecords: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number; durationMs: number; toolCalls: number; reportedTokens: number; estimatedTokens: number; unknownTokens: number; unknownCostRecords: number; legacyRecords: number; byAgent: Record<string, { records: number; tokens: number; costUsd: number }>; byDay: Record<string, { records: number; tokens: number; costUsd: number }> }
const path = (): string => join(homeStateDir(), 'usage.json');
export async function recordUsage(input: Omit<UsageRecord, 'id' | 'createdAt'>): Promise<UsageRecord> { const record: UsageRecord = { ...input, id: createId('usage'), createdAt: new Date().toISOString() }; await withFileLock(`${path()}.lock`, async () => { const records = await readJson<UsageRecord[]>(path(), []); records.push(record); await writeJson(path(), records.slice(-100_000)); }); return record; }
export async function listUsage(options: { sessionId?: string; since?: string } = {}): Promise<UsageRecord[]> { const since = options.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY; return (await readJson<UsageRecord[]>(path(), [])).filter((item) => (!options.sessionId || item.sessionId === options.sessionId) && Date.parse(item.createdAt) >= since); }
export function summarizeUsage(records: readonly UsageRecord[]): UsageSummary {
  const summary: UsageSummary = { records: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, reasoningReportedRecords:0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, durationMs: 0, toolCalls: 0, reportedTokens: 0, estimatedTokens: 0, unknownTokens: 0, unknownCostRecords: 0, legacyRecords: 0, byAgent: {}, byDay: {} };
  for (const item of records) {
    summary.records++; summary.inputTokens += item.inputTokens; summary.outputTokens += item.outputTokens;
    if(Number.isSafeInteger(item.reasoningTokens)&&item.reasoningTokens!>=0&&item.reasoningTokens!<=item.outputTokens){summary.reasoningTokens+=item.reasoningTokens!;summary.reasoningReportedRecords++;}
    summary.cacheReadTokens += item.cacheReadTokens; summary.cacheWriteTokens += item.cacheWriteTokens;
    summary.costUsd += item.costUsd; summary.durationMs += item.durationMs; summary.toolCalls += item.toolCalls;
    if (item.schemaVersion !== 2) summary.legacyRecords++;
    if (!item.costSource || item.costSource === 'unknown') summary.unknownCostRecords++;
    for (const [tokens, source] of [[item.inputTokens, item.inputSource], [item.outputTokens, item.outputSource]] as const) {
      if (source === 'reported') summary.reportedTokens += tokens;
      else if (source === 'estimated') summary.estimatedTokens += tokens;
      else summary.unknownTokens += tokens;
    }
    const tokens = item.inputTokens + item.outputTokens;
    const agent = summary.byAgent[item.agentId] ??= { records: 0, tokens: 0, costUsd: 0 };
    agent.records++; agent.tokens += tokens; agent.costUsd += item.costUsd;
    const day = summary.byDay[item.createdAt.slice(0, 10)] ??= { records: 0, tokens: 0, costUsd: 0 };
    day.records++; day.tokens += tokens; day.costUsd += item.costUsd;
  }
  return summary;
}

export function formatUsageSummary(summary: UsageSummary): string {
  return [`Requests: ${summary.records}`, `Cumulative input: ${summary.inputTokens} · output: ${summary.outputTokens}`,
    `Token sources · reported: ${summary.reportedTokens} · estimated: ${summary.estimatedTokens} · unknown: ${summary.unknownTokens}`,
    `Cache subsets (already in v2 input) · read: ${summary.cacheReadTokens} · write: ${summary.cacheWriteTokens}`,
    `Reported reasoning subset (already in output): ${summary.reasoningReportedRecords?summary.reasoningTokens:'unavailable'} · reported in ${summary.reasoningReportedRecords}/${summary.records} requests`,
    `Cost: ${summary.unknownCostRecords || !summary.records ? 'unavailable / incomplete; consult your endpoint billing' : `~$${summary.costUsd.toFixed(4)} at configured prices (not provider billing)`}`,
    ...(summary.legacyRecords ? [`Legacy records: ${summary.legacyRecords}; old cache semantics/provenance cannot be reconstructed reliably.`] : []),
    'Cumulative usage is not context occupancy. Interrupted/failed requests may not have reported usage.'].join('\n');
}
export async function usageInsights(options: { sessionId?: string; since?: string } = {}): Promise<UsageSummary & { averageTokensPerTurn: number; averageDurationMs: number }> { const summary = summarizeUsage(await listUsage(options)); return { ...summary, averageTokensPerTurn: summary.records ? Math.round((summary.inputTokens + summary.outputTokens) / summary.records) : 0, averageDurationMs: summary.records ? Math.round(summary.durationMs / summary.records) : 0 }; }
export function toOpenTelemetryMetrics(summary: UsageSummary, serviceName = 'ccpt'): Record<string, unknown> { const now = String(Date.now() * 1_000_000); return { resourceMetrics: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] }, scopeMetrics: [{ scope: { name: 'ccpt.usage' }, metrics: [{ name: 'ccpt_tokens_total', sum: { dataPoints: [{ asInt: String(summary.inputTokens + summary.outputTokens), timeUnixNano: now }], aggregationTemporality: 2, isMonotonic: true } }, { name: 'ccpt_cost_usd_total', sum: { dataPoints: [{ asDouble: summary.costUsd, timeUnixNano: now }], aggregationTemporality: 2, isMonotonic: true } }, { name: 'ccpt_tool_calls_total', sum: { dataPoints: [{ asInt: String(summary.toolCalls), timeUnixNano: now }], aggregationTemporality: 2, isMonotonic: true } }] }] }] }; }
