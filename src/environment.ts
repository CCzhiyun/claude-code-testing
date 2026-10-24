import type { PermissionMode, PlatformConfig } from './types.js';

const sensitiveName = /(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION|PRIVATE|CERT|SSH|AWS|AZURE|GOOGLE|GCP)/i;

export function sanitizedEnvironment(mode: PermissionMode, additions: NodeJS.ProcessEnv = {}, allowedNames: string[] = [], deniedNames: string[] = []): NodeJS.ProcessEnv {
  if (mode === 'bypass') return { ...process.env, ...additions };
  const safe: NodeJS.ProcessEnv = {};
  const allowed = new Set(allowedNames.map((name) => name.toUpperCase()));
  const denied = new Set(deniedNames.map((name) => name.toUpperCase()));
  for (const [name, value] of Object.entries(process.env)) {
    if (denied.has(name.toUpperCase())) continue;
    const isAllowed = allowed.has(name.toUpperCase());
    if (((mode === 'normal' || mode === 'acceptEdits') && !sensitiveName.test(name)) || ((mode === 'sandbox' || mode === 'restricted') && isAllowed)) safe[name] = value;
  }
  return { ...safe, ...additions };
}

/** Model credentials are for Agent workers, not inherited by their command tools. */
export function modelCredentialNames(config?: PlatformConfig): string[] {
  return [...(config?.model.apiKeyEnv ? [config.model.apiKeyEnv] : []), ...Object.values(config?.model.headersFromEnvironment ?? {})];
}
