import { isAnalyticsDisabled } from './config.js';

export type AnalyticsValue = string | number | boolean | null;
export type AnalyticsMetadata = Record<string, AnalyticsValue>;
export type AnalyticsSink = { name?: string; log(eventName: string, metadata: AnalyticsMetadata): void | Promise<void>; shutdown?(): void | Promise<void> };

const sinks = new Set<AnalyticsSink>();

export function stripProtoFields<V>(value: V): V {
  if (Array.isArray(value)) return value.map(stripProtoFields) as V;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('$')).map(([key, item]) => [key, stripProtoFields(item)])) as V;
}

export function attachAnalyticsSink(sink: AnalyticsSink): () => void {
  sinks.add(sink);
  return () => sinks.delete(sink);
}

export function logEvent(eventName: string, metadata: AnalyticsMetadata = {}): void {
  if (isAnalyticsDisabled() || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(eventName)) return;
  for (const sink of sinks) void Promise.resolve(sink.log(eventName, stripProtoFields(metadata))).catch(() => undefined);
}

export async function logEventAsync(eventName: string, metadata: AnalyticsMetadata = {}): Promise<void> {
  if (isAnalyticsDisabled() || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(eventName)) return;
  await Promise.allSettled([...sinks].map((sink) => sink.log(eventName, stripProtoFields(metadata))));
}

export async function shutdownAnalytics(): Promise<void> {
  await Promise.allSettled([...sinks].map((sink) => sink.shutdown?.()));
  sinks.clear();
}

export function _resetForTesting(): void { sinks.clear(); }
