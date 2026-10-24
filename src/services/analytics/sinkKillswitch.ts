export type SinkName = 'datadog' | 'firstParty';

export function isSinkKilled(sink: SinkName, env: NodeJS.ProcessEnv = process.env): boolean {
  const killed = new Set((env.CCPT_DISABLED_ANALYTICS_SINKS ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  return killed.has('*') || killed.has(sink);
}
