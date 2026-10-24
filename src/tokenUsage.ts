/** Input totals include cached input; cache counters are subsets, never added twice. */
export interface ModelUsage { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; /** Subset of output, never add it to output again. */ reasoningTokens?: number }
export type TokenSource = 'reported' | 'estimated' | 'unknown';
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function tokenNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function normalizeUsage(value: unknown, protocol: 'messages' | 'compatible' | 'responses'): ModelUsage | undefined {
  const raw = object(value);
  const details = object(protocol === 'responses' ? raw.input_tokens_details : raw.prompt_tokens_details);
  const input = tokenNumber(protocol !== 'compatible' ? raw.input_tokens : raw.prompt_tokens);
  const output = tokenNumber(protocol !== 'compatible' ? raw.output_tokens : raw.completion_tokens);
  const reasoning = tokenNumber(object(protocol === 'responses' ? raw.output_tokens_details : raw.completion_tokens_details).reasoning_tokens);
  const read = tokenNumber(protocol === 'messages' ? raw.cache_read_input_tokens : details.cached_tokens);
  const write = tokenNumber(protocol === 'messages' ? raw.cache_creation_input_tokens : details.cache_write_tokens ?? raw.cache_creation_input_tokens);
  const usage: ModelUsage = {
    ...(input === undefined ? {} : { inputTokens: input + (protocol === 'messages' ? (read ?? 0) + (write ?? 0) : 0) }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(reasoning === undefined || output !== undefined && reasoning > output ? {} : { reasoningTokens: reasoning }),
    ...(read === undefined ? {} : { cacheReadTokens: read }),
    ...(write === undefined ? {} : { cacheWriteTokens: write }),
  };
  return Object.keys(usage).length ? usage : undefined;
}

/** Model-independent fallback, explicitly approximate; not a billing tokenizer. */
export function estimateTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? '';
  let weight = 0;
  for (const char of text) weight += char.codePointAt(0)! <= 0x7f ? 0.25 : /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(char) ? 1 : 1.5;
  return Math.ceil(weight);
}
