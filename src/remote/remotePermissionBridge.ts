import { audit } from '../audit.js';

export interface RemotePermissionRequest {
  requestId: string;
  sessionId: string;
  tool: string;
  input: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export class RemotePermissionBridge {
  private readonly pending = new Map<string, RemotePermissionRequest>();

  async receive(request: RemotePermissionRequest): Promise<void> {
    if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(request.requestId)) throw new Error('Invalid remote permission request ID');
    if (Date.parse(request.expiresAt) <= Date.now()) throw new Error('Remote permission request has expired');
    if (this.pending.has(request.requestId)) throw new Error('Duplicate remote permission request');
    this.pending.set(request.requestId, structuredClone(request));
    await audit({ event: 'RemotePermissionRequest', outcome: 'allowed', sessionId: request.sessionId, details: { requestId: request.requestId, tool: request.tool } });
  }

  list(): RemotePermissionRequest[] {
    this.expire();
    return [...this.pending.values()].map((request) => structuredClone(request));
  }

  async resolve(requestId: string, decision: 'allow' | 'deny'): Promise<RemotePermissionRequest> {
    this.expire();
    const request = this.pending.get(requestId);
    if (!request) throw new Error(`Unknown or expired remote permission request: ${requestId}`);
    this.pending.delete(requestId);
    await audit({ event: 'RemotePermissionResponse', outcome: decision === 'allow' ? 'allowed' : 'denied', sessionId: request.sessionId, details: { requestId, tool: request.tool } });
    return structuredClone(request);
  }

  private expire(): void {
    const now = Date.now();
    for (const [id, request] of this.pending) if (Date.parse(request.expiresAt) <= now) this.pending.delete(id);
  }
}
