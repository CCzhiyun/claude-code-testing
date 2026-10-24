import { createId } from './storage.js';
import { publishCommittedInvalidation, committedProducerTopic } from './projectEvents.js';

export type CommitProducer = 'plans' | 'notifications' | `tasks:task_${string}` | `teams:team_${string}` | `agents:agent_${string}` | `inbox:agent_${string}`;
export interface CommitOutbox {
  generation: string;
  sequence: number;
  acknowledged: number;
  pending: Array<{ sequence: number; at: string }>;
}
const limit = 256;
export function validateCommitOutbox(value: CommitOutbox | undefined): void {
  if (value === undefined) return; // Legacy snapshots acquire an outbox on their next mutation.
  if (!value || !/^outbox_[a-f0-9]{16}$/.test(value.generation)
    || !Number.isSafeInteger(value.sequence) || !Number.isSafeInteger(value.acknowledged)
    || value.acknowledged < 0 || value.sequence < value.acknowledged
    || !Array.isArray(value.pending) || value.pending.length > limit
    || value.sequence - value.acknowledged !== value.pending.length
    || value.pending.some((row, index) => !row || row.sequence !== value.acknowledged + index + 1
      || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at)))) throw new Error('Invalid committed outbox; operator recovery required');
}
/** Call BEFORE side effects, while holding the owning snapshot lock. Full queues
 * apply backpressure; an undelivered intent is never evicted to make room. */
export function enqueueCommit(previous: CommitOutbox | undefined): CommitOutbox {
  validateCommitOutbox(previous);
  const next = previous ? structuredClone(previous) : { generation: createId('outbox'), sequence: 0, acknowledged: 0, pending: [] };
  if (next.pending.length >= limit || next.sequence >= Number.MAX_SAFE_INTEGER) throw new Error('Committed outbox is full; repair delivery before another mutation');
  next.pending.push({ sequence: ++next.sequence, at: new Date().toISOString() });
  return next;
}
/** Caller persists the updated checkpoint under the SAME snapshot lock. A crash
 * between publish and acknowledge is safe: the journal deduplicates the stable ID. */
export async function deliverCommits(cwd: string, producer: CommitProducer, value: CommitOutbox | undefined) {
  validateCommitOutbox(value);
  if (!value) return 0;
  let delivered = 0;
  for (const row of value.pending) {
    const topic = committedProducerTopic(producer);
    if (!topic) throw new Error('Invalid committed producer');
    await publishCommittedInvalidation(cwd, producer, value.generation, row.sequence, row.at, topic);
    delivered++;
  }
  value.acknowledged = value.sequence;
  value.pending = [];
  return delivered;
}
export function outboxSummary(value: CommitOutbox | undefined) {
  validateCommitOutbox(value);
  return { pending: value?.pending.length ?? 0, sequence: value?.sequence ?? 0, acknowledged: value?.acknowledged ?? 0, capacity: limit };
}
