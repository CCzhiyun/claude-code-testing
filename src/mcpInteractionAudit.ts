import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { audit } from './audit.js';
interface Scope { operationId: string; serverDigest: string; transport: string }
const scopes = new AsyncLocalStorage<Scope>();
const replies = new WeakMap<object, ReturnType<typeof interactionTrace>>();
export function withMcpAuditScope<T>(server: string, transport: string, action: () => T): T {
  return scopes.run({ operationId: randomUUID(), serverDigest: createHash('sha256').update(server).digest('hex').slice(0, 24), transport }, action);
}
/** Only local identifiers and finite phases; never prompts, form values or remote IDs. */
export function interactionTrace(method: string) {
  const scope = scopes.getStore() ?? { operationId: randomUUID(), serverDigest: 'direct-sdk', transport: 'callback' };
  const interactionId = randomUUID();
  return { async record(phase: string, outcome: 'requested' | 'allowed' | 'denied' | 'success' | 'failure' = 'success') {
    await audit({ event: 'mcp.interaction', outcome, details: { ...scope, interactionId, kind: ['sampling/createMessage', 'elicitation/create'].includes(method) ? method : 'unsupported', phase } });
  } };
}
export function traceMcpReply(reply: object, trace: ReturnType<typeof interactionTrace>): void { replies.set(reply, trace); }
export async function auditMcpReply(reply: object, phase: 'reply-written' | 'reply-acknowledged'): Promise<void> { await replies.get(reply)?.record(phase); }
