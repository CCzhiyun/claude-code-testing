import { validateElicitationResponse, type ElicitationRequest } from '../services/mcp/elicitationHandler.js';

const units: Record<string, number> = { s: 1_000, sec: 1_000, second: 1_000, seconds: 1_000, m: 60_000, min: 60_000, minute: 60_000, minutes: 60_000, h: 3_600_000, hour: 3_600_000, hours: 3_600_000, d: 86_400_000, day: 86_400_000, days: 86_400_000 };

export function parseMcpDateTime(value: string, now = new Date()): Date {
  const input = value.trim();
  const relative = input.match(/^(?:in\s+)?(\d+(?:\.\d+)?)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|h|days?|d)$/i);
  if (relative?.[1] && relative[2]) return new Date(now.getTime() + Number(relative[1]) * units[relative[2].toLowerCase()]!);
  if (/^tomorrow(?:\s+at\s+\d{1,2}(?::\d{2})?)?$/i.test(input)) {
    const result = new Date(now); result.setDate(result.getDate() + 1); const time = input.match(/at\s+(\d{1,2})(?::(\d{2}))?/i); result.setHours(Number(time?.[1] ?? 9), Number(time?.[2] ?? 0), 0, 0); return result;
  }
  if (/^\d{10,13}$/.test(input)) return new Date(input.length === 10 ? Number(input) * 1_000 : Number(input));
  const timestamp = Date.parse(input); if (!Number.isFinite(timestamp)) throw new Error(`Invalid MCP date/time: ${value}`); return new Date(timestamp);
}

export function normalizeElicitationResponse(request: ElicitationRequest, response: Record<string, unknown>): Record<string, unknown> { return validateElicitationResponse(request, response); }
