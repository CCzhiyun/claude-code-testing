import type { AnalyticsMetadata, AnalyticsSink } from './index.js';
import { attachAnalyticsSink } from './index.js';
import { isAnalyticsDisabled } from './config.js';
import { isSinkKilled } from './sinkKillswitch.js';

let detach: (() => void) | undefined;
let sender: ((event: { event: string; metadata: AnalyticsMetadata; timestamp: string }) => Promise<void>) | undefined;

export async function initializeDatadog(customSender?: typeof sender): Promise<boolean> {
  if (isAnalyticsDisabled() || isSinkKilled('datadog') || !customSender) return false;
  sender = customSender;
  const sink: AnalyticsSink = { name: 'datadog', log: trackDatadogEvent };
  detach = attachAnalyticsSink(sink);
  return true;
}

export async function shutdownDatadog(): Promise<void> { detach?.(); detach = undefined; sender = undefined; }
export async function trackDatadogEvent(eventName: string, metadata: AnalyticsMetadata = {}): Promise<void> {
  if (!sender || isSinkKilled('datadog')) return;
  await sender({ event: eventName, metadata, timestamp: new Date().toISOString() });
}
