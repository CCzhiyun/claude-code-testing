import type { ContentBlock, ModelMessage, PlatformConfig, ToolDefinition } from './types.js';
import { StringDecoder } from 'node:string_decoder';
import { parseToolArguments, toolUse } from './modelToolSafety.js';
import { networkRequest } from './network.js';
import { chatReasoningFields } from './modelCapabilities.js';
import { modelToolChoiceFields } from './modelToolChoice.js';
import { normalizeModelStringForApi } from './utils/model.js';
import { SseDecoder } from './cli/transports/SSETransport.js';
import { normalizeUsage, tokenNumber, type ModelUsage } from './tokenUsage.js';
import { completionLimit, modelAuthHeaders, resolveModelEndpoint, usesMessagesApi } from './modelConnection.js';
import { modelRequestError } from './modelErrors.js';
import type { ModelResponse, ModelStreamHandlers } from './model.js';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numeric(value: unknown): number { return tokenNumber(value) ?? 0; }

async function networkJson<T>(...args: Parameters<typeof networkRequest>): Promise<Awaited<ReturnType<typeof networkRequest>> & { value: T }> {
  const response = await networkRequest(...args);
  if (response.status < 200 || response.status >= 300) throw modelRequestError(response.status, response.text, response.headers);
  let value: T;
  try { value = JSON.parse(response.text) as T; } catch { throw new Error('Model returned invalid JSON; response body omitted for privacy'); }
  if (record(value).error) throw modelRequestError(400, value, response.headers, true);
  return { ...response, value };
}

function textFromCompatibleApi(content: unknown): ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return [{ type: 'text', text: JSON.stringify(content) }];
}

function toCompatibleMessages(messages: ModelMessage[]): Array<Record<string, unknown>> {
  const converted: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (typeof message.content === 'string') {
      converted.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === 'assistant') {
      const text = message.content.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('\n');
      const reasoning = message.content.filter(block => block.type === 'thinking').map(block => block.text ?? '').join('\n');
      const toolCalls = message.content.filter((block) => block.type === 'tool_use').map((block) => ({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
      }));
      converted.push({ role: 'assistant', content: text || null, ...(reasoning ? { reasoning_content: reasoning } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
      continue;
    }
    const toolResults = message.content.filter((block) => block.type === 'tool_result');
    if (toolResults.length) {
      for (const block of toolResults) converted.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content ?? '' });
    } else {
      const parts = message.content.flatMap((block): Array<Record<string, unknown>> => {
        if (block.type === 'text') return block.text ? [{ type: 'text', text: block.text }] : [];
        if (block.type === 'image' && block.data && block.media_type) return [{ type: 'image_url', image_url: { url: `data:${block.media_type};base64,${block.data}` } }];
        if(block.type==='audio')return [{type:'input_audio',input_audio:{data:block.data,format:block.media_type==='audio/wav'?'wav':'mp3'}}];
        return [];
      });
      converted.push({ role: 'user', content: parts.length === 1 && parts[0]?.type === 'text' ? parts[0].text : parts });
    }
  }
  return converted;
}

function toAnthropicMessages(messages: ModelMessage[]): Array<Record<string, unknown>> {
  return messages.map((message) => {
    if (typeof message.content === 'string') return { role: message.role, content: message.content };
    const content = message.content.flatMap((block): Array<Record<string, unknown>> => {
      if (block.type === 'text') return block.text ? [{ type: 'text', text: block.text }] : [];
      if (block.type === 'thinking') return block.text ? [{ type: 'thinking', thinking: block.text, ...(block.signature ? { signature: block.signature } : {}) }] : [];
      if (block.type === 'tool_use') return [{ type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} }];
      if (block.type === 'tool_result') return [{ type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content ?? '', ...(block.is_error ? { is_error: true } : {}) }];
      if (block.type === 'image' && block.data && block.media_type) return [{ type: 'image', source: { type: 'base64', media_type: block.media_type, data: block.data } }];
      return [];
    });
    return { role: message.role, content };
  });
}

function modelEndpoint(config: PlatformConfig, protocol: 'compatible' | 'anthropic'): string {
  return resolveModelEndpoint(config.model, protocol === 'anthropic');
}

export function authorizeModelEndpoint(config: PlatformConfig, requestUrl: string): void {
  const endpoint = new URL(requestUrl);
  const local = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
  // Plan mode restricts tools and source edits, not the configured model
  // transport itself; otherwise entering Plan mode could never produce a plan.
  if (!config.policy.allowNetwork && config.policy.mode !== 'restricted' && !local) throw new Error('External model network access is disabled by policy');
}

async function callAnthropicModelStream(config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[], stream: ModelStreamHandlers): Promise<ModelResponse> {
  const requestUrl = modelEndpoint(config, 'anthropic');
  authorizeModelEndpoint(config, requestUrl);
  const requestedThinkingBudget = ({ low: 1_024, medium: 2_048, high: 4_096, xhigh: 5_120, max: 6_144 } as const)[config.model.reasoningEffort];
  const thinkingBudget = Math.min(requestedThinkingBudget, config.model.maxOutputTokens - 1);
  const decoder = new SseDecoder();
  const utf8 = new StringDecoder('utf8');
  const blocks = new Map<number, { type: 'text' | 'thinking' | 'tool_use'; text: string; id?: string; name?: string; json: string; signature?: string; initialInput?: unknown }>();
  const closedBlocks = new Set<number>();
  let messageStopped = false;
  let protocolError: Error | undefined;
  let sawEvents = false;
  let stopReason: string | undefined;
  const rawUsage: Record<string, unknown> = {};
  const mergeUsage = (value: unknown): void => {
    for (const [name, count] of Object.entries(record(value))) if (tokenNumber(count) !== undefined) rawUsage[name] = count;
  };
  let streamError: unknown;
  const consume = (data: string): void => {
    if (!data || data === '[DONE]') return;
    let value: Record<string, unknown>;
    try { value = record(JSON.parse(data)); } catch { protocolError = new Error('Malformed model stream event; no tools executed'); return; }
    sawEvents = true;
    const type = String(value.type ?? '');
    if (type === 'error') { streamError = value; return; }
    if (streamError || protocolError) return;
    if (messageStopped && type !== 'ping') { protocolError = new Error('Model stream changed after message_stop; no tools executed'); return; }
    if (type === 'message_stop') { messageStopped = true; return; }
    if (type === 'message_start') {
      mergeUsage(record(value.message).usage);
      return;
    }
    const index = numeric(value.index);
    if (type.startsWith('content_block_') && (!Number.isSafeInteger(value.index) || Number(value.index) < 0)) { protocolError = new Error('Invalid model content block index; no tools executed'); return; }
    if (type === 'content_block_stop') {
      if (!blocks.has(index) || closedBlocks.has(index)) { protocolError = new Error('Invalid model content block stop; no tools executed'); return; }
      closedBlocks.add(index); return;
    }
    if (type === 'content_block_start') {
      if (blocks.has(index)) { protocolError = new Error('Duplicate model content block; no tools executed'); return; }
      const block = record(value.content_block);
      const blockType = String(block.type ?? 'text');
      if (blockType === 'tool_use') blocks.set(index, { type: 'tool_use', text: '', id: typeof block.id === 'string' ? block.id : '', name: typeof block.name === 'string' ? block.name : '', json: '', initialInput: block.input });
      else if (blockType === 'thinking') blocks.set(index, { type: 'thinking', text: String(block.thinking ?? ''), json: '', ...(typeof block.signature === 'string' ? { signature: block.signature } : {}) });
      else blocks.set(index, { type: 'text', text: String(block.text ?? ''), json: '' });
      return;
    }
    if (type === 'content_block_delta') {
      if (closedBlocks.has(index)) { protocolError = new Error('Model content changed after block stop; no tools executed'); return; }
      const delta = record(value.delta);
      const current = blocks.get(index) ?? { type: 'text' as const, text: '', json: '' };
      const deltaType = String(delta.type ?? '');
      if (deltaType === 'text_delta') { const text = String(delta.text ?? ''); current.text += text; if (text) stream.onTextDelta?.(text); }
      else if (deltaType === 'thinking_delta') { const text = String(delta.thinking ?? ''); current.type = 'thinking'; current.text += text; if (text) stream.onThinkingDelta?.(text); }
      else if (deltaType === 'input_json_delta') { current.type = 'tool_use'; current.json += String(delta.partial_json ?? ''); }
      else if (deltaType === 'signature_delta') current.signature = String(delta.signature ?? '');
      blocks.set(index, current);
      return;
    }
    if (type === 'message_delta') {
      const delta = record(value.delta);
      if (typeof delta.stop_reason === 'string') {
        if (stopReason && stopReason !== delta.stop_reason) { protocolError = new Error('Conflicting model stop reasons; no tools executed'); return; }
        stopReason = delta.stop_reason;
      }
      mergeUsage(value.usage);
    }
  };
  const response = await networkRequest(requestUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'anthropic-version': '2023-06-01', ...modelAuthHeaders(config.model, true) },
    body: JSON.stringify({
      model: normalizeModelStringForApi(config.model.name), max_tokens: config.model.maxOutputTokens, stream: true,
      ...(config.model.thinkingEnabled && thinkingBudget >= 1_024 ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } } : {}),
      system, messages: toAnthropicMessages(messages), tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.input_schema })),
    }),
    onData: (chunk) => { for (const event of decoder.push(utf8.write(chunk))) consume(event.data); },
  }, config.network);
  if (response.status < 200 || response.status >= 300) {
    throw modelRequestError(response.status, response.text, response.headers);
  }
  for (const event of decoder.push(utf8.end())) consume(event.data);
  if (streamError) throw modelRequestError(400, streamError, response.headers, true);
  if (protocolError) throw protocolError;
  if (sawEvents && decoder.hasPendingData) throw new Error('Truncated model stream event; no tools executed');
  if (!sawEvents) {
    const body = record(JSON.parse(response.text));
    if (body.error) throw modelRequestError(400, body, response.headers, true);
    const content: ContentBlock[] = [];
    for (const raw of Array.isArray(body.content) ? body.content : []) {
      const block = record(raw);
      if (block.type === 'text') { const text = String(block.text ?? ''); content.push({ type: 'text', text }); if (text) stream.onTextDelta?.(text); }
      else if (block.type === 'thinking') { const text = String(block.thinking ?? ''); content.push({ type: 'thinking', text, ...(typeof block.signature === 'string' ? { signature: block.signature } : {}) }); if (text) stream.onThinkingDelta?.(text); }
      else if (block.type === 'tool_use') content.push(toolUse(block.id, block.name, block.input));
    }
    const usage = normalizeUsage(body.usage, 'messages');
    return { content, ...(typeof body.stop_reason === 'string' ? { stopReason: body.stop_reason } : {}), ...(usage ? { usage } : {}) };
  }
  const toolBlocks = [...blocks.entries()].filter(([, block]) => block.type === 'tool_use');
  if (toolBlocks.length && (!messageStopped || stopReason !== 'tool_use' || toolBlocks.some(([index]) => !closedBlocks.has(index)))) throw new Error('Incomplete Messages tool stream; no tools executed. Continue this session after checking the output limit.');
  const content: ContentBlock[] = [...blocks.entries()].sort(([left], [right]) => left - right).map(([, block]): ContentBlock => {
    if (block.type === 'thinking') return { type: 'thinking', text: block.text, ...(block.signature ? { signature: block.signature } : {}) };
    if (block.type === 'tool_use') return toolUse(block.id, block.name, block.json ? parseToolArguments(block.json) : block.initialInput);
    return { type: 'text', text: block.text };
  });
  const usage = normalizeUsage(rawUsage, 'messages');
  return { content, ...(stopReason ? { stopReason } : {}), ...(usage ? { usage } : {}) };
}

async function callCompatibleModelStream(config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[], stream: ModelStreamHandlers): Promise<ModelResponse> {
  const requestUrl = modelEndpoint(config, 'compatible');
  authorizeModelEndpoint(config, requestUrl);
  const decoder = new SseDecoder();
  const utf8 = new StringDecoder('utf8');
  let sawDone = false;
  let protocolError: Error | undefined;
  const toolCalls = new Map<number, { id: string; name: string; json: string }>();
  let text = '';
  let thinking = '';
  let sawEvents = false;
  let stopReason: string | undefined;
  let usage: ModelUsage | undefined;
  let streamError: unknown;
  const consume = (data: string): void => {
    if (!data) return;
    if (data === '[DONE]') { sawDone = true; return; }
    let body: Record<string, unknown>;
    try { body = record(JSON.parse(data)); } catch { protocolError = new Error('Malformed model stream event; no tools executed'); return; }
    sawEvents = true;
    if (body.error) { streamError = body; return; }
    if (streamError || protocolError) return;
    if (sawDone) { protocolError = new Error('Model stream changed after DONE; no tools executed'); return; }
    const nextUsage = normalizeUsage(body.usage, 'compatible');
    if (nextUsage) usage = { ...usage, ...nextUsage };
    const choice = record(Array.isArray(body.choices) ? body.choices[0] : undefined);
    const delta = record(choice.delta);
    if (stopReason && Object.keys(delta).length) { protocolError = new Error('Model delta received after finish_reason; no tools executed'); return; }
    if (typeof choice.finish_reason === 'string') {
      if (stopReason && stopReason !== choice.finish_reason) { protocolError = new Error('Conflicting model finish reasons; no tools executed'); return; }
      stopReason = choice.finish_reason;
    }
    if (typeof delta.content === 'string') { text += delta.content; stream.onTextDelta?.(delta.content); }
    if (typeof delta.reasoning_content === 'string') { thinking += delta.reasoning_content; stream.onThinkingDelta?.(delta.reasoning_content); }
    for (const raw of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const call = record(raw); const index = numeric(call.index); const fn = record(call.function);
      if (!Number.isSafeInteger(call.index) || Number(call.index) < 0) { protocolError = new Error('Invalid streamed tool index; no tools executed'); return; }
      const current = toolCalls.get(index) ?? { id: '', name: '', json: '' };
      if (typeof call.id === 'string') {
        if (current.id && current.id !== call.id) { protocolError = new Error('Conflicting streamed tool identity; no tools executed'); return; }
        current.id = call.id;
      }
      if (typeof fn.name === 'string') current.name += fn.name;
      if (typeof fn.arguments === 'string') current.json += fn.arguments;
      toolCalls.set(index, current);
    }
  };
  const response = await networkRequest(requestUrl, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...modelAuthHeaders(config.model, false) },
    body: JSON.stringify({ model: config.model.name, ...completionLimit(config.model), stream: true, stream_options: { include_usage: true }, ...chatReasoningFields(config.model, tools.length), ...modelToolChoiceFields(), ...(config.model.fastMode ? { service_tier: 'priority' } : {}), messages: [{ role: 'system', content: system }, ...toCompatibleMessages(messages)], ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } })) } : {}) }),
    onData: (chunk) => { for (const event of decoder.push(utf8.write(chunk))) consume(event.data); },
  }, config.network);
  if (response.status < 200 || response.status >= 300) throw modelRequestError(response.status, response.text, response.headers);
  for (const event of decoder.push(utf8.end())) consume(event.data);
  if (streamError) throw modelRequestError(400, streamError, response.headers, true);
  if (protocolError) throw protocolError;
  if (sawEvents && decoder.hasPendingData) throw new Error('Truncated model stream event; no tools executed');
  if (!sawEvents) {
    const body = record(JSON.parse(response.text)); const choice = record(Array.isArray(body.choices) ? body.choices[0] : undefined); const message = record(choice.message);
    if (body.error) throw modelRequestError(400, body, response.headers, true);
    const content = textFromCompatibleApi(message.content ?? '');
    for (const block of content) if (block.type === 'text' && block.text) stream.onTextDelta?.(block.text);
    if (typeof message.reasoning_content === 'string') { content.unshift({ type: 'thinking', text: message.reasoning_content }); stream.onThinkingDelta?.(message.reasoning_content); }
    for (const raw of Array.isArray(message.tool_calls) ? message.tool_calls : []) { const call = record(raw); const fn = record(call.function); content.push(toolUse(call.id, fn.name, parseToolArguments(fn.arguments))); }
    const usage = normalizeUsage(body.usage, 'compatible');
    return { content, ...(typeof choice.finish_reason === 'string' ? { stopReason: choice.finish_reason } : {}), ...(usage ? { usage } : {}) };
  }
  const content: ContentBlock[] = [];
  if (toolCalls.size && (!sawDone || stopReason !== 'tool_calls')) throw new Error('Incomplete Chat tool stream; no tools executed. Continue this session after checking the output limit.');
  if (thinking) content.push({ type: 'thinking', text: thinking });
  if (text) content.push({ type: 'text', text });
  for (const [, call] of [...toolCalls.entries()].sort(([left], [right]) => left - right)) content.push(toolUse(call.id, call.name, parseToolArguments(call.json)));
  return { content, ...(stopReason ? { stopReason } : {}), ...(usage ? { usage } : {}) };
}

async function callAnthropicModel(config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[]): Promise<ModelResponse> {
  const requestUrl = modelEndpoint(config, 'anthropic');
  authorizeModelEndpoint(config, requestUrl);
  const requestedThinkingBudget = ({ low: 1_024, medium: 2_048, high: 4_096, xhigh: 5_120, max: 6_144 } as const)[config.model.reasoningEffort];
  const thinkingBudget = Math.min(requestedThinkingBudget, config.model.maxOutputTokens - 1);
  const response = await networkJson<{
    content?: Array<{ type?: string; text?: string; thinking?: string; signature?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
    error?: { message?: string };
  }>(requestUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...modelAuthHeaders(config.model, true),
    },
    body: JSON.stringify({
      // Match Claude Code: [1m]/[2m] select the client context window and
      // must be removed before the model name is sent to the API.
      model: normalizeModelStringForApi(config.model.name),
      max_tokens: config.model.maxOutputTokens,
      ...(config.model.thinkingEnabled && thinkingBudget >= 1_024 ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } } : {}),
      system,
      messages: toAnthropicMessages(messages),
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.input_schema })),
    }),
  }, config.network);
  const body = response.value;
  if (response.status < 200 || response.status >= 300) throw modelRequestError(response.status, response.text, response.headers);
  const content: ContentBlock[] = [];
  for (const block of body.content ?? []) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text ?? '' });
    else if (block.type === 'thinking') content.push({ type: 'thinking', text: block.thinking ?? '', ...(block.signature ? { signature: block.signature } : {}) });
    else if (block.type === 'tool_use') content.push(toolUse(block.id, block.name, block.input));
  }
  const usage = normalizeUsage(body.usage, 'messages');
  return { content, ...(body.stop_reason ? { stopReason: body.stop_reason } : {}), ...(usage ? { usage } : {}) };
}

/** Explicit legacy adapters only; never selected as a fallback for a failed Responses request. */
export async function callLegacyModel(
  config: PlatformConfig,
  system: string,
  messages: ModelMessage[],
  tools: ToolDefinition[],
  stream?: ModelStreamHandlers,
): Promise<ModelResponse> {
  if (stream) {
    if (usesMessagesApi(config.model)) return callAnthropicModelStream(config, system, messages, tools, stream);
    return callCompatibleModelStream(config, system, messages, tools, stream);
  }
  if (usesMessagesApi(config.model)) return callAnthropicModel(config, system, messages, tools);
  const requestUrl = modelEndpoint(config, 'compatible');
  authorizeModelEndpoint(config, requestUrl);
  const converted = toCompatibleMessages(messages);
  const response = await networkJson<{ choices?: Array<{ message?: { content?: unknown; reasoning_content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; cache_creation_input_tokens?: number }; error?: { message?: string } }>(requestUrl, {
    method: 'POST', headers: { 'content-type': 'application/json', ...modelAuthHeaders(config.model, false) },
    body: JSON.stringify({
      model: config.model.name,
      ...completionLimit(config.model),
      ...chatReasoningFields(config.model, tools.length),
      ...modelToolChoiceFields(),
      ...(config.model.fastMode ? { service_tier: 'priority' } : {}),
      messages: [{ role: 'system', content: system }, ...converted],
      ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } })) } : {}),
    }),
  }, config.network);
  const body = response.value;
  if (response.status < 200 || response.status >= 300) throw modelRequestError(response.status, response.text, response.headers);
  const choice = body.choices?.[0];
  const blocks = textFromCompatibleApi(choice?.message?.content ?? '');
  if (choice?.message?.reasoning_content) blocks.unshift({ type: 'thinking', text: choice.message.reasoning_content });
  for (const call of choice?.message?.tool_calls ?? []) {
    blocks.push(toolUse(call.id, call.function.name, parseToolArguments(call.function.arguments)));
  }
  const usage = normalizeUsage(body.usage, 'compatible');
  return { content: blocks, ...(choice?.finish_reason ? { stopReason: choice.finish_reason } : {}), ...(usage ? { usage } : {}) };
}
