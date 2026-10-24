export interface InboundBridgeMessage {
  id: string;
  sessionId: string;
  kind: 'user_message' | 'interrupt' | 'permission_response';
  createdAt: string;
  payload: Record<string, unknown>;
}

export class InboundMessageValidator {
  private readonly seen = new Set<string>();
  constructor(private readonly maxBytes = 256 * 1024) {}

  validate(value: unknown, expectedSessionId?: string): InboundBridgeMessage {
    if (!value || typeof value !== 'object') throw new Error('Inbound bridge message must be an object');
    const item = value as Record<string, unknown>;
    if (typeof item.id !== 'string' || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(item.id)) throw new Error('Inbound bridge message has an invalid ID');
    if (this.seen.has(item.id)) throw new Error('Duplicate inbound bridge message');
    if (typeof item.sessionId !== 'string' || (expectedSessionId && item.sessionId !== expectedSessionId)) throw new Error('Inbound bridge message session mismatch');
    if (!['user_message', 'interrupt', 'permission_response'].includes(String(item.kind))) throw new Error('Unsupported inbound bridge message kind');
    if (typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) throw new Error('Inbound bridge message has an invalid timestamp');
    if (!item.payload || typeof item.payload !== 'object' || Array.isArray(item.payload)) throw new Error('Inbound bridge message payload must be an object');
    if (Buffer.byteLength(JSON.stringify(value)) > this.maxBytes) throw new Error('Inbound bridge message exceeds the size limit');
    this.seen.add(item.id);
    if (this.seen.size > 10_000) this.seen.delete(this.seen.values().next().value!);
    return structuredClone(item) as unknown as InboundBridgeMessage;
  }
}
