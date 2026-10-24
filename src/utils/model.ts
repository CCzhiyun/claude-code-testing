export type ContextWindow = 200_000 | 1_000_000;
export interface ModelSelectionPolicy { availableModels?: readonly string[]; disabledModels?: readonly string[]; allowExtendedContext?: boolean }

export function normalizeModelId(value: string): string { return value.replace(/\u001b\[[0-9;]*m/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim(); }
/**
 * Claude Code treats `[1m]` and `[2m]` as client-side context-window
 * selectors. They are useful in settings and the model picker, but are not
 * part of the model identifier accepted by the Anthropic Messages API.
 */
export function normalizeModelStringForApi(value: string): string { return normalizeModelId(value).replace(/\[(1|2)m\]/gi, ''); }
export function hasExtendedContextSuffix(value: string): boolean { return /\[1m\]$/i.test(normalizeModelId(value)); }
export function baseModelId(value: string): string { return normalizeModelStringForApi(value); }
export function contextWindowForModel(value: string, policy: ModelSelectionPolicy = {}): ContextWindow { return hasExtendedContextSuffix(value) && policy.allowExtendedContext !== false ? 1_000_000 : 200_000; }
export function modelAllowed(value: string, policy: ModelSelectionPolicy): boolean {
  const model = normalizeModelId(value); const base = baseModelId(model);
  if (policy.disabledModels?.some((item) => [model, base].includes(normalizeModelId(item)))) return false;
  if (!policy.availableModels?.length) return true;
  return policy.availableModels.some((item) => { const allowed = normalizeModelId(item); return allowed === model || baseModelId(allowed) === base; });
}
export function filterAllowedModels(models: readonly string[], policy: ModelSelectionPolicy): string[] { return [...new Set(models.map(normalizeModelId).filter(Boolean))].filter((model) => modelAllowed(model, policy)); }
export function modelDeprecationMessage(model: string, retired: Readonly<Record<string, string>>): string | undefined { const replacement = retired[baseModelId(model)]; return replacement ? `${baseModelId(model)} is retired; use ${replacement}.` : undefined; }
