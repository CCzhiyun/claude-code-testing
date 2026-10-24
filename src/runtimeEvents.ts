import type { AgentStatus } from './types.js';

export interface RuntimeEventContext {
  agentId: string;
  sessionId: string;
  teamSessionId?: string;
  taskId?: string;
}

export type RuntimeEventData = RuntimeEventContext & (
  | { type: 'agent_status'; status: AgentStatus; detail?: string }
  | { type: 'turn_started'; turn: number }
  | { type: 'context_recovery'; turn: number; notice: import('./contextRecovery.js').ContextRecoveryNotice }
  | { type: 'context_pressure'; turn: number; notice: import('./contextBudget.js').ContextPressureNotice }
  | { type: 'model_retry'; turn: number; notice: import('./modelRetry.js').RetryNotice }
  | { type: 'thinking_delta'; turn: number; delta: string }
  | { type: 'text_delta'; turn: number; delta: string; displaySuppressed?:boolean }
  | { type: 'display_message'; turn:number; text:string }
  | { type: 'assistant_message'; turn:number; text:string }
  | { type: 'usage_updated'; turn: number; inputTokens: number; outputTokens: number; toolCalls: number; inputTokenSource?: 'reported' | 'estimated'; outputTokenSource?: 'reported' | 'estimated' }
  | { type: 'tool_started'; turn: number; toolUseId?: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_completed'; turn: number; toolUseId?: string; name: string; output: string; isError: boolean; durationMs: number }
  | { type: 'input_required'; question: string }
  | { type: 'agent_completed'; result: string }
  | { type: 'agent_failed'; error: string }
);

export type RuntimeEvent = RuntimeEventData & { sequence: number; at: string };
export type RuntimeEventPayload = RuntimeEventData extends infer Event
  ? Event extends RuntimeEventContext ? Omit<Event, keyof RuntimeEventContext> : never
  : never;
export type RuntimeEventListener = (event: RuntimeEvent) => void;
export interface RuntimeEventFilter { agentId?: string; sessionId?: string; teamSessionId?: string }

function matches(event: RuntimeEvent, filter: RuntimeEventFilter): boolean {
  return (!filter.agentId || event.agentId === filter.agentId)
    && (!filter.sessionId || event.sessionId === filter.sessionId)
    && (!filter.teamSessionId || event.teamSessionId === filter.teamSessionId);
}

/**
 * Process-local event backbone shared by CLI, TUI, IDE and SDK surfaces.
 * Background workers also persist their latest stream snapshot on AgentRecord,
 * so observers in another process can recover after reconnecting.
 */
export class RuntimeEventBus {
  #sequence = 0;
  readonly #listeners = new Set<{ listener: RuntimeEventListener; filter: RuntimeEventFilter }>();

  publish(data: RuntimeEventData): RuntimeEvent {
    const event = Object.freeze({ ...data, sequence: ++this.#sequence, at: new Date().toISOString() }) as RuntimeEvent;
    for (const subscription of this.#listeners) {
      if (!matches(event, subscription.filter)) continue;
      try { subscription.listener(event); } catch { /* A passive surface must not interrupt Agent execution. */ }
    }
    return event;
  }

  subscribe(listener: RuntimeEventListener, filter: RuntimeEventFilter = {}): () => void {
    const subscription = { listener, filter: { ...filter } };
    this.#listeners.add(subscription);
    return () => { this.#listeners.delete(subscription); };
  }
}

export const runtimeEventBus = new RuntimeEventBus();

export function publishRuntimeEvent(data: RuntimeEventData, observer?: RuntimeEventListener): RuntimeEvent {
  const event = runtimeEventBus.publish(data);
  if (observer) {
    try { observer(event); } catch { /* Request observers are isolated like global subscribers. */ }
  }
  return event;
}
