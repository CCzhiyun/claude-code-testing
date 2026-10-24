import { initialize1PEventLogging } from './firstPartyEventLogger.js';
import { initializeDatadog } from './datadog.js';

let initialized = false;
export function initializeAnalyticsGates(): void { initialized = true; }
export async function initializeAnalyticsSink(options: { firstParty?: Parameters<typeof initialize1PEventLogging>[0]; datadog?: Parameters<typeof initializeDatadog>[0] } = {}): Promise<void> {
  if (!initialized) initializeAnalyticsGates();
  initialize1PEventLogging(options.firstParty);
  await initializeDatadog(options.datadog);
}
