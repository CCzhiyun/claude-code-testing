import type { ContentBlock } from './types.js';

/** Never turn missing, truncated or non-object arguments into a runnable empty call. */
export function parseToolArguments(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid tool arguments JSON; no tools executed');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('Invalid tool arguments JSON; no tools executed'); }
  return toolArgumentsObject(parsed);
}

export function toolArgumentsObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be an object; no tools executed');
  return value as Record<string, unknown>;
}

export function toolUse(id: unknown, name: unknown, input: unknown): ContentBlock {
  if (typeof id !== 'string' || !id.trim() || typeof name !== 'string' || !name.trim()) throw new Error('Invalid tool call identity; no tools executed');
  return { type: 'tool_use', id, name, input: toolArgumentsObject(input) };
}

export function validateModelToolCalls(content: ContentBlock[], stopReason?: string): void {
  const ids = new Set<string>();
  for (const block of content) {
    if (block.type !== 'tool_use') continue;
    toolUse(block.id, block.name, block.input);
    if (ids.has(block.id!)) throw new Error('Duplicate tool call identity; no tools executed');
    ids.add(block.id!);
  }
  // JSON-compatible gateways sometimes omit a reason; explicit truncation is never accepted.
  if (ids.size && stopReason && !['tool_calls', 'tool_use', 'stop', 'end_turn'].includes(stopReason)) throw new Error('Incomplete model tool response; no tools executed. Continue this session after checking the output limit.');
}
