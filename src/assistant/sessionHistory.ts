import type { ModelMessage } from '../types.js';
import { loadSession } from '../sessions.js';

export const HISTORY_PAGE_SIZE = 100;
export interface HistoryEvent { id: string; index: number; message: ModelMessage }
export interface HistoryPage { events: HistoryEvent[]; firstId: string | null; hasMore: boolean }

function eventId(index: number): string { return `message_${String(index).padStart(8, '0')}`; }
function parseEventId(id: string): number { const match = id.match(/^message_(\d{8})$/); if (!match?.[1]) throw new Error(`Invalid history cursor: ${id}`); return Number(match[1]); }

async function page(sessionId: string, endExclusive: number | undefined, limit: number): Promise<HistoryPage> {
  const session = await loadSession(sessionId);
  const all = [...(session.archivedMessages ?? []), ...session.messages];
  const end = Math.min(all.length, endExclusive ?? all.length);
  const size = Math.max(1, Math.min(limit, 1_000));
  const start = Math.max(0, end - size);
  const events = all.slice(start, end).map((message, offset) => ({ id: eventId(start + offset), index: start + offset, message }));
  return { events, firstId: events[0]?.id ?? null, hasMore: start > 0 };
}

export async function fetchLatestEvents(sessionId: string, limit = HISTORY_PAGE_SIZE): Promise<HistoryPage> { return page(sessionId, undefined, limit); }
export async function fetchOlderEvents(sessionId: string, beforeId: string, limit = HISTORY_PAGE_SIZE): Promise<HistoryPage> { return page(sessionId, parseEventId(beforeId), limit); }
