export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelRoutingPolicy {
  defaultModel: string;
  aliases?: Record<string, string>;
  /** Maps an unversioned family or resolved alias to an exact provider model id. */
  pins?: Record<string, string>;
  fallbacks?: Record<string, string[]>;
  availableModels?: string[];
  advisorModel?: string;
  fastModels?: Record<string, string>;
  maximumEffort?: ReasoningEffort;
}

export interface ModelRouteRequest {
  model?: string;
  role?: 'default' | 'advisor';
  reasoningEffort?: ReasoningEffort;
  fast?: boolean;
}

export interface ResolvedModelRoute {
  requested: string;
  primary: string;
  candidates: string[];
  reasoningEffort: ReasoningEffort;
  serviceTier: 'default' | 'priority';
  usedAlias: boolean;
  pinned: boolean;
}

const effortOrder: readonly ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const normalize = (value: string): string => value.trim().toLowerCase();

function capEffort(requested: ReasoningEffort, maximum: ReasoningEffort): ReasoningEffort {
  return effortOrder[Math.min(effortOrder.indexOf(requested), effortOrder.indexOf(maximum))] ?? 'high';
}

function lookup(mapping: Record<string, string> | undefined, key: string): string | undefined {
  if (!mapping) return undefined;
  const normalized = normalize(key);
  return Object.entries(mapping).find(([name]) => normalize(name) === normalized)?.[1];
}

function fallbackList(mapping: Record<string, string[]> | undefined, key: string): string[] {
  if (!mapping) return [];
  const normalized = normalize(key);
  return Object.entries(mapping).find(([name]) => normalize(name) === normalized)?.[1] ?? [];
}

export function resolveModelRoute(request: ModelRouteRequest, policy: ModelRoutingPolicy): ResolvedModelRoute {
  const requested = request.model?.trim() || (request.role === 'advisor' && policy.advisorModel?.trim()) || policy.defaultModel.trim();
  if (!requested) throw new Error('A default model is required');
  const alias = lookup(policy.aliases, requested);
  const aliased = alias ?? requested;
  const pin = lookup(policy.pins, aliased);
  const pinned = pin ?? aliased;
  const fast = request.fast ? lookup(policy.fastModels, pinned) ?? lookup(policy.fastModels, aliased) : undefined;
  const primary = fast ?? pinned;
  const rawCandidates = [primary, ...fallbackList(policy.fallbacks, primary), ...fallbackList(policy.fallbacks, pinned), ...fallbackList(policy.fallbacks, aliased)];
  const available = policy.availableModels?.length ? new Set(policy.availableModels.map(normalize)) : undefined;
  const candidates = [...new Set(rawCandidates.map((item) => lookup(policy.aliases, item) ?? item).map((item) => lookup(policy.pins, item) ?? item))]
    .filter((item) => !available || available.has(normalize(item)));
  if (candidates.length === 0) throw new Error(`No available model route for ${requested}`);
  return {
    requested,
    primary: candidates[0]!,
    candidates,
    reasoningEffort: capEffort(request.reasoningEffort ?? 'high', policy.maximumEffort ?? 'max'),
    serviceTier: request.fast ? 'priority' : 'default',
    usedAlias: alias !== undefined,
    pinned: pin !== undefined,
  };
}

export function isRetryableModelFailure(error: unknown): boolean {
  const value = error as { status?: number; code?: string; message?: string };
  if (value.status === 408 || value.status === 409 || value.status === 429 || (value.status ?? 0) >= 500) return true;
  return /timeout|temporar|overload|rate.?limit|connection|unavailable|reset/i.test(value.message ?? value.code ?? '');
}

export async function callWithModelFallback<T>(
  route: ResolvedModelRoute,
  invoke: (model: string, attempt: number) => Promise<T>,
): Promise<{ value: T; model: string; attempts: number }> {
  let lastError: unknown;
  for (let index = 0; index < route.candidates.length; index += 1) {
    const model = route.candidates[index]!;
    try { return { value: await invoke(model, index + 1), model, attempts: index + 1 }; }
    catch (error) {
      lastError = error;
      if (!isRetryableModelFailure(error) || index === route.candidates.length - 1) throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Model route failed');
}
