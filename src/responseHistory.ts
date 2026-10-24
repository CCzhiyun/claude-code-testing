import { createHash } from 'node:crypto';
import type { ModelMessage } from './types.js';

/** Provider metadata must not contribute to its own continuity binding. */
export const responseHistoryHash = (messages: ModelMessage[]): string =>
  createHash('sha256').update(JSON.stringify(messages.map(({ role, content }) => ({ role, content })))).digest('hex');

/** Only trusted compaction may rebind an unchanged suffix. Never re-enable an
 * invalid marker, mutate the archive, or reuse a server ID for rewritten history.
 * The caller replaces only the leading summary; every retained item is identical
 * and in order, including all calls/results since the current user message. */
export function rebaseCompactedResponses(before: ModelMessage[], after: ModelMessage[]): ModelMessage[] {
  const summary = after[0];
  if (summary?.role !== 'user' || typeof summary.content !== 'string' ||
      !/^\[(?:Earlier conversation summary|Context compacted:)/.test(summary.content)) return after;
  const offset = before.length - (after.length - 1);
  if (offset < 0 || after.slice(1).some((message, index) => message !== before[offset + index])) return after;
  return after.map((message, index) => {
    const marker = message.responses;
    if (index === 0 || message.role !== 'assistant' || !marker ||
        marker.prefixHash !== responseHistoryHash(before.slice(0, offset + index))) return message;
    return { ...message, responses: { ...marker,
      prefixHash: responseHistoryHash(after.slice(0, index + 1)), stored: false,
    } };
  });
}
