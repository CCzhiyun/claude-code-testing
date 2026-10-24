import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PlatformConfig } from './types.js';

export type EnterpriseRole = 'viewer' | 'developer' | 'reviewer' | 'operator' | 'administrator';
export type EnterpriseAction = 'session.read' | 'session.run' | 'artifact.share' | 'git.push' | 'policy.read' | 'policy.write' | 'runner.manage';
export interface EnterpriseIdentity { subject: string; organization: string; roles: EnterpriseRole[]; groups?: string[] }
const roleActions: Record<EnterpriseRole, readonly EnterpriseAction[]> = {
  viewer: ['session.read', 'policy.read'], developer: ['session.read', 'session.run', 'policy.read'], reviewer: ['session.read', 'artifact.share', 'policy.read'], operator: ['session.read', 'session.run', 'artifact.share', 'git.push', 'policy.read', 'runner.manage'], administrator: ['session.read', 'session.run', 'artifact.share', 'git.push', 'policy.read', 'policy.write', 'runner.manage'],
};
export function authorize(identity: EnterpriseIdentity, action: EnterpriseAction, requiredOrganization?: string): { allowed: boolean; reason: string } { if (requiredOrganization && identity.organization !== requiredOrganization) return { allowed: false, reason: 'Identity belongs to a different organization' }; const roles = identity.roles.filter((role) => roleActions[role]); if (roles.some((role) => roleActions[role].includes(action))) return { allowed: true, reason: `Allowed by role ${roles.find((role) => roleActions[role].includes(action))}` }; return { allowed: false, reason: `No assigned role permits ${action}` }; }

export type EnterpriseModelProvider = 'anthropic' | 'bedrock' | 'vertex' | 'foundry' | 'gateway';
export interface ProviderProfile { provider: EnterpriseModelProvider; model: string; endpointUrl: string; apiKeyHeader: string; apiKeyPrefix: string; headersFromEnvironment: Record<string, string> }
export function providerProfile(input: { provider: EnterpriseModelProvider; model: string; endpointUrl: string; region?: string; project?: string; deployment?: string }): ProviderProfile {
  const url = new URL(input.endpointUrl); if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error('Enterprise provider endpoints must use HTTPS');
  const common = { provider: input.provider, model: input.model, endpointUrl: url.href, apiKeyPrefix: 'Bearer ', headersFromEnvironment: {} };
  if (input.provider === 'bedrock') return { ...common, apiKeyHeader: 'authorization', apiKeyPrefix: '', headersFromEnvironment: { 'x-aws-region': 'AWS_REGION', 'x-aws-access-key-id': 'AWS_ACCESS_KEY_ID' } };
  if (input.provider === 'vertex') return { ...common, apiKeyHeader: 'authorization', headersFromEnvironment: { 'x-goog-user-project': 'GOOGLE_CLOUD_PROJECT' } };
  if (input.provider === 'foundry') return { ...common, apiKeyHeader: 'api-key', apiKeyPrefix: '', headersFromEnvironment: {} };
  return { ...common, apiKeyHeader: 'authorization' };
}
export function applyProviderProfile(config: PlatformConfig, profile: ProviderProfile): PlatformConfig { const next = structuredClone(config); next.model.name = profile.model; next.model.endpointUrl = profile.endpointUrl; delete next.model.baseUrl; next.model.apiKeyHeader = profile.apiKeyHeader; next.model.apiKeyPrefix = profile.apiKeyPrefix; next.model.headersFromEnvironment = profile.headersFromEnvironment; if (!next.network.allowedHosts.includes(new URL(profile.endpointUrl).hostname)) next.network.allowedHosts.push(new URL(profile.endpointUrl).hostname); return next; }

export interface SpendPolicy { monthlyLimitUsd: number; warningPercent: number; hardLimit: boolean }
export function evaluateSpend(policy: SpendPolicy, usedUsd: number, requestedUsd = 0): { allowed: boolean; utilization: number; warning: boolean; remainingUsd: number } { if (policy.monthlyLimitUsd <= 0) throw new Error('Spend limit must be positive'); const total = Math.max(0, usedUsd) + Math.max(0, requestedUsd); const utilization = total / policy.monthlyLimitUsd; return { allowed: !policy.hardLimit || utilization <= 1, utilization, warning: utilization >= policy.warningPercent / 100, remainingUsd: Math.max(0, policy.monthlyLimitUsd - total) }; }

export interface DataRetentionPolicy { mode: 'standard' | 'zero-retention'; sessionDays: number; auditDays: number; allowFeedbackContent: boolean }
export function retentionDeadline(createdAt: string, policy: DataRetentionPolicy, kind: 'session' | 'audit'): string { if (policy.mode === 'zero-retention' && kind === 'session') return createdAt; const days = kind === 'session' ? policy.sessionDays : policy.auditDays; return new Date(Date.parse(createdAt) + Math.max(0, days) * 86_400_000).toISOString(); }
export function privacyBoundFeedback(message: string, policy: DataRetentionPolicy): { message?: string; metadataOnly: boolean } { return policy.allowFeedbackContent && policy.mode !== 'zero-retention' ? { message: message.slice(0, 20_000), metadataOnly: false } : { metadataOnly: true }; }

export interface RunnerSessionIdentity { sessionId: string; runnerId: string; organization: string; expiresAt: string; signature: string }
const canonicalIdentity = (identity: Omit<RunnerSessionIdentity, 'signature'>): string => `${identity.sessionId}\n${identity.runnerId}\n${identity.organization}\n${identity.expiresAt}`;
export function signRunnerIdentity(identity: Omit<RunnerSessionIdentity, 'signature'>, secret: string): RunnerSessionIdentity { if (Date.parse(identity.expiresAt) <= Date.now()) throw new Error('Runner identity must expire in the future'); return { ...identity, signature: createHmac('sha256', secret).update(canonicalIdentity(identity)).digest('base64url') }; }
export function verifyRunnerIdentity(identity: RunnerSessionIdentity, secret: string, organization: string, now = Date.now()): boolean { if (identity.organization !== organization || Date.parse(identity.expiresAt) <= now) return false; const expected = Buffer.from(createHmac('sha256', secret).update(canonicalIdentity(identity)).digest('base64url')); const actual = Buffer.from(identity.signature); return expected.length === actual.length && timingSafeEqual(expected, actual); }

export interface ExternalSurfaceAdapter { readonly name: string; readonly capabilities: readonly string[]; health(): Promise<{ ready: boolean; detail?: string }>; invoke(action: string, input: unknown): Promise<unknown> }
export class ExternalSurfaceRegistry {
  readonly #adapters = new Map<string, ExternalSurfaceAdapter>();
  register(adapter: ExternalSurfaceAdapter): void { if (!/^[a-zA-Z0-9_.-]+$/.test(adapter.name) || this.#adapters.has(adapter.name)) throw new Error(`Invalid or duplicate surface adapter: ${adapter.name}`); this.#adapters.set(adapter.name, adapter); }
  list(): Array<{ name: string; capabilities: readonly string[] }> { return [...this.#adapters.values()].map(({ name, capabilities }) => ({ name, capabilities })); }
  async health(name: string): Promise<{ ready: boolean; detail?: string }> { const adapter = this.#adapters.get(name); if (!adapter) throw new Error(`External surface adapter is not installed: ${name}`); return adapter.health(); }
  async invoke(name: string, action: string, input: unknown): Promise<unknown> { const adapter = this.#adapters.get(name); if (!adapter) throw new Error(`External surface adapter is not installed: ${name}`); if (!adapter.capabilities.includes(action)) throw new Error(`Adapter ${name} does not support ${action}`); const health = await adapter.health(); if (!health.ready) throw new Error(`Adapter ${name} is unavailable: ${health.detail ?? 'health check failed'}`); return adapter.invoke(action, input); }
}
