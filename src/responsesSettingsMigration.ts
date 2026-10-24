import type { PlatformConfig } from './types.js';

const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

/** GLM-specific, explicit migration: its observed upstream is Chat, not native Responses. */
export function migrateGlmResponsesSettings(source: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(source);
  const env = { ...object(result.env) }, model = { ...object(result.model) };
  const destination = model.endpointUrl || model.baseUrl || env.ANTHROPIC_BASE_URL;
  if (!destination || new URL(destination).origin !== 'https://open.bigmodel.cn') throw new Error('GLM migration only accepts the explicitly configured https://open.bigmodel.cn destination');
  const name = typeof result.model === 'string' ? result.model : model.name || env.OPENAI_MODEL || env.ANTHROPIC_DEFAULT_SONNET_MODEL;
  if (typeof name !== 'string' || !/^glm-/i.test(name)) throw new Error('GLM migration requires an existing GLM model name; no model substitution is performed');
  const legacyKey = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
  if (legacyKey && env.OPENAI_API_KEY && legacyKey !== env.OPENAI_API_KEY) throw new Error('Conflicting credentials: choose the GLM credential explicitly before migration');
  if (legacyKey) env.OPENAI_API_KEY = legacyKey;
  const window = Number(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
  const timeout = Number(env.API_TIMEOUT_MS);
  for (const key of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'CLAUDE_CODE_AUTO_COMPACT_WINDOW', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'API_TIMEOUT_MS']) delete env[key];
  result.env = env;
  result.model = { ...model, provider: 'openai', apiProtocol: 'responses', responsesTransport: 'chat-completions', name,
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', endpointUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    apiKeyEnv: 'OPENAI_API_KEY', apiKeyHeader: 'authorization', apiKeyPrefix: 'Bearer ', headersFromEnvironment: {},
    completionTokenField: 'max_tokens', responsesStore: false, responsesTextFormat: null,
    ...(Number.isSafeInteger(window) && window > 0 && model.maxContextTokens === undefined ? { maxContextTokens: window } : {}),
  } satisfies Partial<PlatformConfig['model']>;
  if (Number.isSafeInteger(timeout) && timeout > 0 && object(result.network).timeoutMs === undefined) result.network = { ...object(result.network), timeoutMs: timeout };
  return result;
}
