import type { HookDefinition, HookEvent } from '../types.js';

export interface HookMatcher { matcher?: string; hooks: HookDefinition[] }
export type HooksSettings = Partial<Record<HookEvent, HookMatcher[]>>;

export function parseHooksSettings(value: unknown): HooksSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Hooks settings must be an object');
  const output: HooksSettings = {};
  for (const [event, matchers] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(matchers)) throw new Error(`Hooks for ${event} must be an array`);
    output[event as HookEvent] = matchers.map((matcher) => parseMatcher(matcher, event));
  }
  return output;
}

function parseMatcher(value: unknown, event: string): HookMatcher {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Hook matcher for ${event} must be an object`);
  const item = value as Record<string, unknown>;
  if (item.matcher !== undefined && typeof item.matcher !== 'string') throw new Error(`Hook matcher for ${event} must be text`);
  if (!Array.isArray(item.hooks)) throw new Error(`Hook matcher for ${event} requires hooks`);
  return { ...(typeof item.matcher === 'string' ? { matcher: item.matcher } : {}), hooks: item.hooks.map((hook) => parseHook(hook, event)) };
}

function parseHook(value: unknown, event: string): HookDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Hook for ${event} must be an object`);
  const hook = value as Record<string, unknown>;
  const type = hook.type ?? 'command';
  if (!['command', 'http', 'prompt', 'agent'].includes(String(type))) throw new Error(`Unsupported hook type: ${String(type)}`);
  const required = type === 'http' ? 'url' : type === 'command' ? 'command' : 'prompt';
  if (typeof hook[required] !== 'string' || !(hook[required] as string).trim()) throw new Error(`${type} hook requires ${required}`);
  return { ...structuredClone(hook), event } as unknown as HookDefinition;
}
