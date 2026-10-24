import type { ModelMessage } from '../types.js';
export class QueuedMessageContext { private queue: ModelMessage[] = []; enqueue(message: ModelMessage): void { this.queue.push(structuredClone(message)); } drain(): ModelMessage[] { const result = this.queue; this.queue = []; return result; } get size(): number { return this.queue.length; } }
