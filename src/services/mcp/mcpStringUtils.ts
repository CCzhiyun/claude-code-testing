export const truncateMcpString = (value: string, limit = 10_000): string => value.length > limit ? `${value.slice(0, limit)}…` : value;
export function stringifyMcpValue(value: unknown): string { if (typeof value === 'string') return value; try { return JSON.stringify(value, null, 2); } catch { return String(value); } }
