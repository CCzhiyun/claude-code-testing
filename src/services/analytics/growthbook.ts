export type GrowthBookUserAttributes = Record<string, string | number | boolean | null>;
type FeatureMap = Record<string, unknown>;

let features: FeatureMap = {};
let overrides: FeatureMap = {};
let refresh: (() => Promise<FeatureMap>) | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function envKey(feature: string): string { return `CCPT_FEATURE_${feature.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`; }
function parseEnv(value: string): unknown { try { return JSON.parse(value); } catch { return value; } }
function resolveFeature<T>(feature: string, fallback: T): T {
  const env = process.env[envKey(feature)];
  if (env !== undefined) return parseEnv(env) as T;
  if (Object.hasOwn(overrides, feature)) return overrides[feature] as T;
  return Object.hasOwn(features, feature) ? features[feature] as T : fallback;
}

export function onGrowthBookRefresh(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
export function hasGrowthBookEnvOverride(feature: string): boolean { return process.env[envKey(feature)] !== undefined; }
export function getAllGrowthBookFeatures(): FeatureMap { return structuredClone(features); }
export function getGrowthBookConfigOverrides(): FeatureMap { return structuredClone(overrides); }
export function setGrowthBookConfigOverride(feature: string, value: unknown): void { overrides = { ...overrides, [feature]: value }; listeners.forEach((listener) => listener()); }
export function clearGrowthBookConfigOverrides(): void { overrides = {}; listeners.forEach((listener) => listener()); }
export function getApiBaseUrlHost(): string | undefined { try { return process.env.CCPT_BASE_URL ? new URL(process.env.CCPT_BASE_URL).host : undefined; } catch { return undefined; } }
export async function initializeGrowthBook(loader?: () => Promise<FeatureMap>): Promise<boolean> { refresh = loader; if (loader) await refreshGrowthBookFeatures(); return true; }
export async function getFeatureValue_DEPRECATED<T>(feature: string, fallback: T): Promise<T> { if (refresh && !Object.hasOwn(features, feature)) await refreshGrowthBookFeatures(); return resolveFeature(feature, fallback); }
export function getFeatureValue_CACHED_MAY_BE_STALE<T>(feature: string, fallback: T): T { return resolveFeature(feature, fallback); }
export function getFeatureValue_CACHED_WITH_REFRESH<T>(feature: string, fallback: T): T { if (refresh) void refreshGrowthBookFeatures(); return resolveFeature(feature, fallback); }
export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(feature: string): boolean { return Boolean(resolveFeature(feature, false)); }
export async function checkSecurityRestrictionGate(feature: string): Promise<boolean> { return Boolean(await getFeatureValue_DEPRECATED(feature, false)); }
export async function checkGate_CACHED_OR_BLOCKING(feature: string): Promise<boolean> { return Boolean(await getFeatureValue_DEPRECATED(feature, false)); }
export function refreshGrowthBookAfterAuthChange(): void { if (refresh) void refreshGrowthBookFeatures(); }
export function resetGrowthBook(): void { features = {}; overrides = {}; refresh = undefined; stopPeriodicGrowthBookRefresh(); }
export async function refreshGrowthBookFeatures(): Promise<void> { if (!refresh) return; features = structuredClone(await refresh()); listeners.forEach((listener) => listener()); }
export function setupPeriodicGrowthBookRefresh(periodMs = 300_000): void { stopPeriodicGrowthBookRefresh(); interval = setInterval(() => void refreshGrowthBookFeatures(), Math.max(10_000, periodMs)); interval.unref?.(); }
export function stopPeriodicGrowthBookRefresh(): void { if (interval) clearInterval(interval); interval = undefined; }
export async function getDynamicConfig_BLOCKS_ON_INIT<T>(feature: string, fallback: T): Promise<T> { return getFeatureValue_DEPRECATED(feature, fallback); }
export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(feature: string, fallback: T): T { return resolveFeature(feature, fallback); }
