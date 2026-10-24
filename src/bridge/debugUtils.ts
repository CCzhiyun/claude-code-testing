export function redactBridgeDebug(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/\b(?:Bearer\s+)?[A-Za-z0-9_-]{24,}\b/g, '[redacted]');
  if (Array.isArray(value)) return value.map(redactBridgeDebug);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, /token|secret|authorization|credential/i.test(key) ? '[redacted]' : redactBridgeDebug(item)]));
  return value;
}
