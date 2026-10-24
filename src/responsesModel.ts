import { createHash } from 'node:crypto';
import { modelToolChoiceFields } from './modelToolChoice.js';
import { StringDecoder } from 'node:string_decoder';
import type { ContentBlock, ModelMessage, PlatformConfig, ToolDefinition } from './types.js';
import type { ModelResponse, ModelStreamHandlers } from './model.js';
import { networkRequest } from './network.js';
import { modelAuthHeaders, resolveModelEndpoint } from './modelConnection.js';
import { modelRequestError } from './modelErrors.js';
import { normalizeUsage } from './tokenUsage.js';
import { SseDecoder } from './cli/transports/SSETransport.js';
import { normalizeModelStringForApi } from './utils/model.js';
import { responsesChatBridge } from './responsesChatBridge.js';
import type { ResponsesRequest, ResponsesResponse } from './responsesProtocol.js';
import { responseHistoryHash } from './responseHistory.js';
export { responseHistoryHash } from './responseHistory.js';

type Item = Record<string, unknown>;
const object = (value: unknown): Item => value && typeof value === 'object' && !Array.isArray(value) ? value as Item : {};
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function responsesInput(messages: ModelMessage[], scope: string): Item[] {
  const items: Item[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role === 'assistant' && message.responses?.scope === scope && message.responses.prefixHash === responseHistoryHash(messages.slice(0, index + 1))) {
      // Keep encrypted reasoning and function-call items intact for stateless replay.
      items.push(...message.responses.output);
      continue;
    }
    if (typeof message.content === 'string') { items.push({ role: message.role, content: message.content }); continue; }
    for (const block of message.content) {
      if (block.type === 'text' && block.text) items.push(message.role === 'assistant'
        ? { role: 'assistant', content: block.text }
        : { role: message.role, content: [{ type: 'input_text', text: block.text }] });
      else if (block.type === 'image' && block.data && block.media_type && message.role === 'user') items.push({ role: 'user', content: [{ type: 'input_image', image_url: `data:${block.media_type};base64,${block.data}` }] });
      else if (block.type === 'tool_use') items.push({ type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
      else if (block.type === 'tool_result') items.push({ type: 'function_call_output', call_id: block.tool_use_id, output: block.content ?? '' });
    }
  }
  return items;
}

export function responsesRequest(config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[], streaming: boolean): { body: ResponsesRequest; scope: string } {
  const model = config.model;
  // A changed destination, credential or deployment must never inherit another server's IDs.
  const scope = hash([resolveModelEndpoint(model), model.name, modelAuthHeaders(model, false), model.responsesTransport ?? 'native']);
  let previous: string | undefined;
  let inputMessages = messages;
  if (model.responsesStore && !model.inputTokenCounting) {
    for (let index = messages.length - 1; index >= 0; index--) {
      const marker = messages[index]?.responses;
      if (!marker) continue;
      if (marker.stored && marker.scope === scope && marker.prefixHash === responseHistoryHash(messages.slice(0, index + 1))) {
        previous = marker.id; inputMessages = messages.slice(index + 1);
      }
      break;
    }
  }
  return { scope, body: {
    model: normalizeModelStringForApi(model.name), instructions: system,
    input: responsesInput(inputMessages, scope), max_output_tokens: model.maxOutputTokens,
    store: model.responsesStore === true, stream: streaming,
    ...modelToolChoiceFields(),
    ...(previous ? { previous_response_id: previous } : {}),
    include: ['reasoning.encrypted_content'],
    ...(model.thinkingEnabled ? { reasoning: { effort: model.reasoningEffort === 'max' ? 'xhigh' : model.reasoningEffort } } : {}),
    ...(model.fastMode ? { service_tier: 'priority' } : {}),
    ...(model.responsesTextFormat ? { text: { format: model.responsesTextFormat } } : {}),
    ...(tools.length ? { tools: tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema, strict: false })) } : {}),
  } };
}

function parseResponse(body: Item, scope: string, messages: ModelMessage[], stored: boolean, headers: Record<string, string | string[] | undefined>): ModelResponse {
  if (body.error || body.status === 'failed') throw modelRequestError(400, body, headers, true);
  // Never execute a partially generated function, or report truncated output as success.
  if (body.status !== 'completed') throw new Error(`Responses API did not complete (${String(body.status ?? 'missing status')}; ${String(object(body.incomplete_details).reason ?? 'no completion reason')}). No tools were executed; increase output limit or inspect the provider response.`);
  if (!Array.isArray(body.output)) throw new Error('Responses API returned no output array');
  const output = body.output.map(object);
  const content: ContentBlock[] = [];
  for (const item of output) {
    if (item.type === 'message') {
      for (const raw of Array.isArray(item.content) ? item.content : []) {
        const part = object(raw);
        if (part.type === 'output_text' && typeof part.text === 'string') content.push({ type: 'text', text: part.text });
        if (part.type === 'refusal' && typeof part.refusal === 'string') content.push({ type: 'text', text: part.refusal });
      }
    } else if (item.type === 'function_call') {
      if (item.status !== undefined && item.status !== 'completed') throw new Error('Incomplete Responses function output; no tools executed');
      if (typeof item.call_id !== 'string' || !item.call_id || typeof item.name !== 'string' || !item.name || typeof item.arguments !== 'string') throw new Error('Invalid Responses function call identity or arguments');
      let input: unknown;
      try { input = JSON.parse(item.arguments); } catch { throw new Error('Invalid Responses function arguments JSON; no tools executed'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Responses function arguments must be an object');
      content.push({ type: 'tool_use', id: item.call_id, name: item.name, input: input as Item });
    } else if (item.type === 'reasoning') {
      const summary = (Array.isArray(item.summary) ? item.summary : []).map((part) => object(part).text).filter((text): text is string => typeof text === 'string').join('\n');
      if (summary) content.push({ type: 'thinking', text: summary });
    }
  }
  if (!content.length) throw new Error('Responses API completed without supported text or function output');
  const usage = normalizeUsage(body.usage, 'responses');
  return { response: body as ResponsesResponse, content, stopReason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn', ...(usage ? { usage } : {}),
    ...(typeof body.id === 'string' && body.id ? { responses: { scope, id: body.id, prefixHash: responseHistoryHash([...messages, { role: 'assistant', content }]), output, stored } } : {}),
  };
}

export async function callResponsesModel(config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[], stream?: ModelStreamHandlers): Promise<ModelResponse> {
  const { body, scope } = responsesRequest(config, system, messages, tools, Boolean(stream));
  if (config.model.responsesTransport === 'chat-completions') {
    const result = await responsesChatBridge(config, body, stream);
    return parseResponse(result, scope, messages, false, {});
  }
  const decoder = new SseDecoder();
  const utf8 = new StringDecoder('utf8');
  let final: Item | undefined;
  let failure: Error | undefined;
  let providerFailure: unknown;
  let sawEvents = false;
  let emittedText = false, emittedThinking = false;
  let terminalSeen = false;
  const consume = (data: string): void => {
    if (!data || data === '[DONE]') return;
    let event: Item;
    try { event = object(JSON.parse(data)); } catch { failure = new Error('Malformed Responses stream event'); return; }
    sawEvents = true;
    if (failure || providerFailure) return;
    if (terminalSeen) { failure = new Error('Responses stream changed after its terminal event; no tools executed'); return; }
    if (event.type === 'error' || event.type === 'response.failed') { providerFailure = event.response ?? (event.error ? event : { error: event }); return; }
    if (event.type === 'response.completed' || event.type === 'response.incomplete') { final = object(event.response); terminalSeen = true; }
    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') { emittedText = true; stream?.onTextDelta?.(event.delta); }
    if (event.type === 'response.refusal.delta' && typeof event.delta === 'string') { emittedText = true; stream?.onTextDelta?.(event.delta); }
    if (event.type === 'response.reasoning_summary_text.delta' && typeof event.delta === 'string') { emittedThinking = true; stream?.onThinkingDelta?.(event.delta); }
    // Tool arguments are only accepted from the completed response, never partial events.
  };
  const response = await networkRequest(resolveModelEndpoint(config.model), {
    method: 'POST', headers: { 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json', ...modelAuthHeaders(config.model, false) },
    body: JSON.stringify(body), maxResponseBytes: 32 * 1024 * 1024,
    ...(stream ? { onData(chunk: Buffer) { for (const event of decoder.push(utf8.write(chunk))) consume(event.data); } } : {}),
  }, config.network);
  if (response.status < 200 || response.status >= 300) {
    // A stale server-side chain can expire. Retry once stateless, before any output,
    // and only for an explicit previous_response_id error (not auth/quota failures).
    let error: Item = {}; try { error = object(object(JSON.parse(response.text)).error); } catch { /* HTTP error below */ }
    if (body.previous_response_id && !emittedText && !emittedThinking && [400, 404].includes(response.status) && (error.param === 'previous_response_id' || error.code === 'previous_response_not_found')) {
      return callResponsesModel({ ...config, model: { ...config.model, responsesStore: false } }, system, messages, tools, stream);
    }
    throw modelRequestError(response.status, response.text, response.headers);
  }
  if (stream) for (const event of decoder.push(utf8.end() + '\n\n')) consume(event.data);
  if (failure) throw failure;
  if (providerFailure) throw modelRequestError(400, providerFailure, response.headers, true);
  if (sawEvents && !final) throw new Error('Responses stream ended without response.completed; no tools executed');
  if (!sawEvents) {
    try { final = object(JSON.parse(response.text)); } catch { throw new Error('Responses API returned invalid JSON'); }
  }
  const result = parseResponse(final!, scope, messages, config.model.responsesStore === true, response.headers);
  for (const block of result.content) {
    if (block.type === 'text' && !emittedText && block.text) stream?.onTextDelta?.(block.text);
    if (block.type === 'thinking' && !emittedThinking && block.text) stream?.onThinkingDelta?.(block.text);
  }
  return result;
}
