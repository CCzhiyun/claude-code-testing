export interface RemoteManagedSettingsEnvelope { version: 1; issuedAt: string; expiresAt: string; settings: Record<string, unknown>; signature: string; keyId: string }
export interface RemoteManagedSettingsCache { envelope: RemoteManagedSettingsEnvelope; etag?: string; fetchedAt: string }
export interface RemoteManagedSettingsResult { settings: Record<string, unknown>; source: 'network' | 'cache'; stale: boolean }
