export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  commands?: string[];
  skills?: string[];
  agents?: string[];
  hooks?: string;
  mcpServers?: string;
}

export function validatePluginManifest(value: unknown): PluginManifest {
  if (!value || typeof value !== 'object') throw new Error('Plugin manifest must be an object');
  const item = value as Record<string, unknown>;
  if (typeof item.name !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(item.name)) throw new Error('Plugin name is invalid');
  if (typeof item.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(item.version)) throw new Error('Plugin version must be semantic');
  for (const key of ['commands', 'skills', 'agents'] as const) if (item[key] !== undefined && (!Array.isArray(item[key]) || item[key].some((entry) => typeof entry !== 'string'))) throw new Error(`Plugin ${key} must contain paths`);
  return structuredClone(item) as unknown as PluginManifest;
}
