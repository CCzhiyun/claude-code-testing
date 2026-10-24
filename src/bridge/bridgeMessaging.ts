import { randomUUID } from 'node:crypto';
import type { BridgeEvent, BridgeEventKind } from './types.js';

export class BridgeMessageQueue {
  private nextSequence = 1;
  private readonly pending = new Map<number, BridgeEvent>();
  private lastAcknowledged = 0;

  constructor(private readonly sessionId: string, initialSequence = 1) {
    if (!sessionId || !Number.isInteger(initialSequence) || initialSequence < 1) throw new Error('Invalid bridge queue state');
    this.nextSequence = initialSequence;
  }

  enqueue(kind: Exclude<BridgeEventKind, 'ack'>, payload: Record<string, unknown>): BridgeEvent {
    const event: BridgeEvent = { id: randomUUID(), sessionId: this.sessionId, sequence: this.nextSequence++, kind, createdAt: new Date().toISOString(), payload: structuredClone(payload) };
    this.pending.set(event.sequence, event);
    return structuredClone(event);
  }

  acknowledge(sequence: number): number {
    if (!Number.isInteger(sequence) || sequence < this.lastAcknowledged || sequence >= this.nextSequence) throw new Error('Invalid or regressive bridge acknowledgement');
    for (const current of this.pending.keys()) if (current <= sequence) this.pending.delete(current);
    this.lastAcknowledged = sequence;
    return this.pending.size;
  }

  batch(limit = 100): BridgeEvent[] {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Bridge batch limit must be positive');
    return [...this.pending.values()].sort((a, b) => a.sequence - b.sequence).slice(0, limit).map((event) => structuredClone(event));
  }

  get unacknowledged(): number { return this.pending.size; }
}
