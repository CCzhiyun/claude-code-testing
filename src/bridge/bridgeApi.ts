import type { PlatformConfig } from '../types.js';
import { networkJson } from '../network.js';
import type { BridgeEvent } from './types.js';

export class BridgeApi {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly network: PlatformConfig['network']) {}

  async publish(sessionId: string, events: BridgeEvent[]): Promise<{ acknowledgedSequence: number }> {
    const response = await networkJson<{ acknowledged_sequence?: unknown }>(new URL(`/v2/sessions/${encodeURIComponent(sessionId)}/events`, this.baseUrl).href, {
      method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ events }),
    }, this.network);
    if (response.status < 200 || response.status >= 300 || !Number.isInteger(response.value.acknowledged_sequence)) throw new Error(`Bridge publish failed (${response.status})`);
    return { acknowledgedSequence: response.value.acknowledged_sequence as number };
  }

  async poll(sessionId: string, cursor?: string): Promise<{ events: unknown[]; cursor?: string }> {
    const url = new URL(`/v2/sessions/${encodeURIComponent(sessionId)}/events`, this.baseUrl);
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await networkJson<{ events?: unknown; cursor?: unknown }>(url.href, { headers: { authorization: `Bearer ${this.token}` } }, this.network);
    if (response.status < 200 || response.status >= 300 || !Array.isArray(response.value.events)) throw new Error(`Bridge poll failed (${response.status})`);
    return { events: response.value.events, ...(typeof response.value.cursor === 'string' ? { cursor: response.value.cursor } : {}) };
  }
}
