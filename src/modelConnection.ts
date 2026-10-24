import type { PlatformConfig } from './types.js';
import { protectedModelKey } from './modelCredentialState.js';
import { createHash } from 'node:crypto';

export const API_PRESETS = ['messages', 'chat-completions', 'responses', 'azure-openai', 'azure-responses'] as const;
export type ApiPreset = typeof API_PRESETS[number];
export type ModelProtocol = 'messages' | 'chat-completions' | 'responses';

export const API_PRESET_LABELS: Record<ApiPreset, string> = {
  messages: 'Messages API',
  'chat-completions': 'Chat Completions / Bearer',
  responses: 'Responses / Bearer',
  'azure-openai': 'Azure / Chat Completions',
  'azure-responses': 'Azure / Responses',
};

export function resolveModelProtocol(model: PlatformConfig['model']): ModelProtocol {
  if (model.apiProtocol !== undefined) {
    if (!['messages', 'responses', 'chat-completions'].includes(model.apiProtocol)) throw new Error('model.apiProtocol must be messages, responses or chat-completions');
    return model.apiProtocol;
  }
  return model.provider === 'anthropic' ? 'messages' : model.provider === 'compatible' ? 'chat-completions' : 'responses';
}

export function resolveModelWireProtocol(model: PlatformConfig['model']): ModelProtocol {
  const protocol = resolveModelProtocol(model);
  return protocol === 'responses' && model.responsesTransport === 'chat-completions' ? 'chat-completions' : protocol;
}

export function connectionPresetForModel(model: PlatformConfig['model']): ApiPreset {
  const protocol = resolveModelProtocol(model);
  if (protocol === 'messages') return 'messages';
  return model.apiKeyHeader?.toLowerCase() === 'api-key' ? protocol === 'responses' ? 'azure-responses' : 'azure-openai' : protocol;
}

export function nextApiPreset(model: PlatformConfig['model']): ApiPreset {
  return API_PRESETS[(API_PRESETS.indexOf(connectionPresetForModel(model)) + 1) % API_PRESETS.length]!;
}
/** Applying a preset clears the old destination and auth mapping to prevent cross-provider credential sends. */
export function apiPresetPatch(preset: ApiPreset): Partial<PlatformConfig['model']> {
  if (!API_PRESETS.includes(preset)) throw new Error('Unknown API preset');
  const azure = preset.startsWith('azure-');
  return {
    provider: preset === 'messages' ? 'anthropic' : ['responses', 'azure-responses'].includes(preset) ? 'openai' : 'compatible',
    responsesTransport: 'native',
    apiProtocol: preset === 'messages' ? 'messages' : ['responses', 'azure-responses'].includes(preset) ? 'responses' : 'chat-completions',
    responsesStore: false,
    responsesTextFormat: null,
    inputTokenCounting: null,
    baseUrl: '', endpointUrl: '', headersFromEnvironment: {},
    apiKeyHeader: preset === 'messages' ? 'x-api-key' : azure ? 'api-key' : 'authorization', apiKeyPrefix: azure || preset === 'messages' ? '' : 'Bearer ',
    apiKeyEnv: preset === 'messages' ? 'CCPT_MESSAGES_API_KEY' : azure ? 'AZURE_OPENAI_API_KEY' : preset === 'responses' ? 'OPENAI_API_KEY' : 'CCPT_API_KEY',
    completionTokenField: preset === 'messages' ? 'max_tokens' : 'max_completion_tokens',
    thinkingEnabled: false, fastMode: false,
    chatToolReasoning: 'preserve',
  };
}

export function usesMessagesApi(model: PlatformConfig['model']): boolean {
  return resolveModelProtocol(model) === 'messages';
}

export function resolveModelEndpoint(model: PlatformConfig['model'], messages = usesMessagesApi(model)): string {
  const value = model.endpointUrl || model.baseUrl;
  if (!value) throw new Error('Model base URL or complete endpoint URL is required');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Model endpoint must be a valid absolute HTTP(S) URL'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Model endpoint must be an HTTP(S) URL without embedded credentials or fragments');
  const protocol = resolveModelWireProtocol(model);
  const route = url.pathname.replace(/\/+$/, '');
  const known = /\/chat\/completions$/i.test(route) ? 'chat-completions' : /\/responses$/i.test(route) ? 'responses' : /\/messages$/i.test(route) ? 'messages' : undefined;
  if (known && known !== protocol) throw new Error(`Model endpoint route is ${known}, but model.apiProtocol is ${protocol}. Select the matching deployment settings; no automatic route switch is performed.`);
  if (model.endpointUrl) return url.href;
  const path = url.pathname.replace(/\/+$/, '');
  if (protocol === 'responses') url.pathname = /\/responses$/i.test(path) ? path : `${path}/responses`;
  else if (messages) url.pathname = /\/messages$/i.test(path) ? path : `${path}${/\/v1$/i.test(path) ? '' : '/v1'}/messages`;
  else url.pathname = /\/chat\/completions$/i.test(path) ? path : `${path}/chat/completions`;
  // URL manipulation preserves Azure deployment paths and api-version query strings.
  return url.href;
}

export function modelAuthHeaders(model: PlatformConfig['model'], messages = usesMessagesApi(model)): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, env] of Object.entries(model.headersFromEnvironment ?? {})) {
    const value = process.env[env];
    if (!value) throw new Error(`Required model header environment variable is not configured: ${env}`);
    headers[name.toLowerCase()] = value;
  }
  const protectedKey = model.credentialRef ? protectedModelKey(model, createHash('sha256').update(resolveModelEndpoint(model)).digest('hex')) : undefined;
  if (model.credentialRef && !protectedKey) throw new Error('Protected model credential is not loaded; use callModel or run model diagnostics first');
  const explicit = protectedKey ?? (model.apiKeyEnv ? process.env[model.apiKeyEnv] : undefined);
  if (model.apiKeyEnv && !explicit) throw new Error(`Model credential environment variable is not configured: ${model.apiKeyEnv}`);
  const bearer = explicit ?? (messages ? process.env.ANTHROPIC_AUTH_TOKEN || process.env.CCPT_API_KEY : process.env.CCPT_API_KEY || process.env.OPENAI_API_KEY);
  const legacyKey = messages && !bearer ? process.env.ANTHROPIC_API_KEY : undefined;
  const key = bearer ?? legacyKey;
  if (key && !Object.keys(headers).some((name) => ['authorization', 'api-key', 'x-api-key'].includes(name))) {
    const header = (model.apiKeyHeader || (legacyKey ? 'x-api-key' : 'authorization')).toLowerCase();
    const prefix = model.apiKeyPrefix ?? (header === 'authorization' ? 'Bearer ' : '');
    // Explicit header mappings win; do not send an accidental second authorization header.
    if (!(header in headers)) headers[header] = `${prefix}${key}`;
  }
  return headers;
}

export function completionLimit(model: PlatformConfig['model']): Record<string, number> {
  return { [model.completionTokenField ?? 'max_tokens']: model.maxOutputTokens };
}
