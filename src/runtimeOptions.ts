import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PlatformConfig } from './types.js';

export async function readOptionObject(value: string, cwd: string): Promise<Record<string, unknown>> {
  const text = value.trimStart().startsWith('{') ? value : await readFile(resolve(cwd, value), 'utf8');
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Runtime configuration exceeds 1 MiB');
  const object: unknown = JSON.parse(text);
  if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('Runtime configuration must be a JSON object');
  if ('env' in object) throw new Error('Use process environment variables for runtime credentials, not --settings env');
  return object as Record<string, unknown>;
}

export async function cliSessionOverrides(args: string[], cwd: string, includeModelFlags = true): Promise<Partial<PlatformConfig>> {
  const values = (flag: string): string[] => args.flatMap((arg, index) => {
    if (arg !== `--${flag}`) return [];
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${flag} requires a value`);
    return [value];
  });
  let overrides: Partial<PlatformConfig> = {};
  const settings = values('settings');
  if (settings.length > 1) throw new Error('Provide one --settings file/object');
  if (settings[0]) overrides = await readOptionObject(settings[0], cwd) as Partial<PlatformConfig>;
  for (const value of values('mcp-config')) {
    const object = await readOptionObject(value, cwd);
    if (!object.mcpServers || typeof object.mcpServers !== 'object' || Array.isArray(object.mcpServers)) throw new Error('--mcp-config requires { "mcpServers": { ... } }');
    overrides.mcpServers = { ...overrides.mcpServers, ...object.mcpServers } as PlatformConfig['mcpServers'];
  }
  const dirs = values('plugin-dir');
  for (const value of values('agents')) overrides.agentDefinitions = { ...overrides.agentDefinitions, ...await readOptionObject(value, cwd) } as NonNullable<PlatformConfig['agentDefinitions']>;
  if (dirs.length) overrides.pluginDirectories = [...(overrides.pluginDirectories ?? []), ...dirs.map((dir) => resolve(cwd, dir))];
  const toolValues = values('tools');
  if (toolValues.length) overrides.toolFilter = toolValues.at(-1)!.split(',').map((name) => name.trim()).filter(Boolean);
  if (toolValues.at(-1)?.trim() === 'default') overrides.toolFilter = null;
  for (const [flag, field] of [['model', 'name'], ['base-url', 'baseUrl'], ['endpoint-url', 'endpointUrl'], ['effort', 'reasoningEffort'], ['api-protocol', 'apiProtocol']] as const) {
    if (!includeModelFlags) continue; // config set applies its coherent preset before validation.
    const value = values(flag).at(-1);
    if (value !== undefined) {
      if (!value.trim()) throw new Error(`--${flag} requires a non-empty value`);
      overrides.model = { ...overrides.model, [field]: value } as PlatformConfig['model'];
      if (flag === 'effort') overrides.model.thinkingEnabled = true;
    }
  }
  const budgetAlias = values('max-budget-usd');
  if (budgetAlias.length && values('budget-usd').length) throw new Error('Use either --budget-usd or --max-budget-usd');
  if (budgetAlias.length) {
    const amount = Number(budgetAlias.at(-1));
    if (!budgetAlias.at(-1)?.trim() || !Number.isFinite(amount) || amount <= 0) throw new Error('--max-budget-usd requires a positive number');
    overrides.spending = { ...overrides.spending, maxCostUsd: amount };
  }
  for (const [flag, field] of [['budget-usd', 'maxCostUsd'], ['max-requests', 'maxRequests']] as const) {
    const value = values(flag).at(-1);
    if (value !== undefined) {
      if (!value.trim() || !Number.isFinite(Number(value))) throw new Error(`--${flag} requires a positive number`);
      overrides.spending = { ...overrides.spending, [field]: Number(value) };
    }
  }
  const mode = values('permission-mode').at(-1);
  if (mode) overrides.policy = { ...overrides.policy, mode } as PlatformConfig['policy'];
  if (args.includes('--restricted')) overrides.policy = { ...overrides.policy, mode: 'restricted', allowNetwork: false } as PlatformConfig['policy'];
  return overrides;
}
