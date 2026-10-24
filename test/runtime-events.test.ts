import { describe, expect, test } from 'bun:test';
import { RuntimeEventBus } from '../src/runtimeEvents.js';

const status = (agentId: string, sessionId: string, value: 'queued' | 'working' | 'completed' = 'working') => ({
  type: 'agent_status' as const,
  agentId,
  sessionId,
  status: value,
});

describe('unified runtime event bus', () => {
  test('orders events and filters subscriptions without letting a surface interrupt the Agent', () => {
    const bus = new RuntimeEventBus();
    const all: number[] = [];
    const selected: string[] = [];
    bus.subscribe((event) => all.push(event.sequence));
    bus.subscribe(() => { throw new Error('passive renderer failure'); });
    const unsubscribe = bus.subscribe((event) => selected.push(event.agentId), { sessionId: 'session-a' });

    const first = bus.publish(status('agent-a', 'session-a', 'queued'));
    const second = bus.publish(status('agent-b', 'session-b'));
    unsubscribe();
    const third = bus.publish(status('agent-c', 'session-a', 'completed'));

    expect([first.sequence, second.sequence, third.sequence]).toEqual([1, 2, 3]);
    expect(all).toEqual([1, 2, 3]);
    expect(selected).toEqual(['agent-a']);
    expect(Date.parse(first.at)).not.toBeNaN();
    expect(Object.isFrozen(first)).toBe(true);
  });
});
