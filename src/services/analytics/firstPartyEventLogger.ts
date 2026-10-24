import { attachAnalyticsSink, type AnalyticsMetadata } from './index.js';
import { getEventMetadata, to1PEventFormat } from './metadata.js';
import { FirstPartyEventLoggingExporter, type FirstPartyEvent } from './firstPartyEventLoggingExporter.js';
import { isAnalyticsDisabled } from './config.js';
import { isSinkKilled } from './sinkKillswitch.js';

export type EventSamplingConfig = { defaultRate: number; events: Record<string, number> };
let sampling: EventSamplingConfig = { defaultRate: 1, events: {} };
let exporter: FirstPartyEventLoggingExporter | undefined;
let detach: (() => void) | undefined;

export function getEventSamplingConfig(): EventSamplingConfig { return structuredClone(sampling); }
export function setEventSamplingConfig(config: EventSamplingConfig): void { sampling = { defaultRate: Math.max(0, Math.min(1, config.defaultRate)), events: { ...config.events } }; }
export function shouldSampleEvent(eventName: string): number | null { const rate = sampling.events[eventName] ?? sampling.defaultRate; return rate <= 0 ? null : Math.max(0, Math.min(1, rate)); }
export function is1PEventLoggingEnabled(): boolean { return Boolean(exporter) && !isAnalyticsDisabled() && !isSinkKilled('firstParty'); }
export async function logEventTo1P(eventName: string, metadata: AnalyticsMetadata = {}): Promise<void> {
  const rate = shouldSampleEvent(eventName);
  if (!exporter || rate === null || Math.random() > rate) return;
  exporter.export(to1PEventFormat(eventName, await getEventMetadata(metadata)) as FirstPartyEvent);
}
export function logGrowthBookExperimentTo1P(experiment: { key: string; variation: string }): void { void logEventTo1P('feature_experiment', { experiment: experiment.key, variation: experiment.variation }); }
export function initialize1PEventLogging(send?: (events: FirstPartyEvent[]) => Promise<void>): void {
  if (!send || isAnalyticsDisabled() || isSinkKilled('firstParty')) return;
  exporter = new FirstPartyEventLoggingExporter(send);
  detach = attachAnalyticsSink({ name: 'firstParty', log: logEventTo1P, shutdown: shutdown1PEventLogging });
}
export async function shutdown1PEventLogging(): Promise<void> { detach?.(); detach = undefined; await exporter?.shutdown(); exporter = undefined; }
export async function reinitialize1PEventLoggingIfConfigChanged(send?: (events: FirstPartyEvent[]) => Promise<void>): Promise<void> { await shutdown1PEventLogging(); initialize1PEventLogging(send); }
