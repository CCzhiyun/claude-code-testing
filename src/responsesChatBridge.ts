import { randomUUID } from 'node:crypto';
import type { ContentBlock, ModelMessage, PlatformConfig, ToolDefinition } from './types.js';
import type { ResponsesItem, ResponsesRequest, ResponsesResponse } from './responsesProtocol.js';
import type { ModelStreamHandlers } from './model.js';
import { callLegacyModel } from './legacyModel.js';
import { parseToolArguments, validateModelToolCalls } from './modelToolSafety.js';
import { withModelToolChoice, validateToolChoiceResult } from './modelToolChoice.js';

/** Explicit, in-process vendor adapter. No HTTP server, no endpoint guessing and no native-Responses claim. */
export async function responsesChatBridge(config: PlatformConfig, request: ResponsesRequest, stream?: ModelStreamHandlers): Promise<ResponsesResponse> {
  if (request.store || request.previous_response_id || request.text) throw new Error('Chat bridge does not emulate stored Responses, previous_response_id or structured outputs');
  const messages: ModelMessage[] = [];
  const append = (role: ModelMessage['role'], blocks: ContentBlock[]): void => {
    const previous = messages.at(-1);
    if (role === 'assistant' && previous?.role === role && Array.isArray(previous.content)) previous.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };
  for (const item of typeof request.input === 'string' ? [{ role: 'user', content: request.input }] : request.input) {
    if (item.type === 'function_call') {
      if (typeof item.call_id !== 'string' || typeof item.name !== 'string') throw new Error('Invalid bridge function identity');
      append('assistant', [{ type: 'tool_use', id: item.call_id, name: item.name, input: parseToolArguments(item.arguments) }]);
    } else if (item.type === 'function_call_output') {
      if (typeof item.call_id !== 'string' || typeof item.output !== 'string') throw new Error('Bridge requires string function outputs with a call_id');
      append('user', [{ type: 'tool_result', tool_use_id: item.call_id, content: item.output }]);
    } else if (item.type === 'reasoning') {
      if (item.encrypted_content) throw new Error('Cannot replay native encrypted reasoning through the Chat bridge');
      const summary = (Array.isArray(item.summary) ? item.summary : []).map(part => typeof part?.text === 'string' ? part.text : '').join('\n');
      if (summary) append('assistant', [{ type: 'thinking', text: summary }]);
    } else if ((item.type === undefined || item.type === 'message') && ['user', 'assistant'].includes(String(item.role))) {
      const role = item.role as ModelMessage['role'];
      if (typeof item.content === 'string') { append(role, [{ type: 'text', text: item.content }]); continue; }
      const blocks: ContentBlock[] = [];
      for (const part of Array.isArray(item.content) ? item.content : []) {
        if (['input_text', 'output_text'].includes(part.type) && typeof part.text === 'string') blocks.push({ type: 'text', text: part.text });
        else if (part.type === 'refusal' && typeof part.refusal === 'string') blocks.push({ type: 'text', text: part.refusal });
        else if (part.type === 'input_image' && typeof part.image_url === 'string') {
          const match = part.image_url.match(/^data:([^;]+);base64,(.+)$/s);
          if (!match) throw new Error('Chat bridge supports inline base64 images only');
          blocks.push({ type: 'image', media_type: match[1]!, data: match[2]! });
        } else throw new Error(`Unsupported Chat bridge content type: ${String(part.type)}`);
      }
      append(role, blocks);
    } else throw new Error(`Unsupported Chat bridge input item: ${String(item.type)}`);
  }
  const tools: ToolDefinition[] = (request.tools ?? []).map(tool => ({ name: tool.name, description: tool.description ?? '', input_schema: tool.parameters }));
  const upstream = structuredClone(config);
  upstream.model = { ...upstream.model, provider: 'compatible', apiProtocol: 'chat-completions', responsesTransport: 'native' };
  const result = await withModelToolChoice(request.tool_choice ?? 'auto', async () => {
    const result = await callLegacyModel(upstream, request.instructions ?? '', messages, tools, stream);
    validateToolChoiceResult(result.content, tools);
    return result;
  });
  validateModelToolCalls(result.content, result.stopReason);
  if (result.stopReason && !['stop', 'end_turn', 'tool_calls', 'tool_use'].includes(result.stopReason)) throw new Error('Chat bridge upstream response did not complete; no tools executed');
  const output: ResponsesItem[] = result.content.map(block => {
    if (block.type === 'tool_use') return { type: 'function_call', call_id: block.id, name: block.name, arguments: JSON.stringify(block.input), status: 'completed' };
    if (block.type === 'thinking') return { type: 'reasoning', summary: [{ type: 'summary_text', text: block.text ?? '' }] };
    return { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: block.text ?? '', annotations: [] }] };
  });
  const u = result.usage;
  return { id: `bridge_resp_${randomUUID().replaceAll('-', '')}`, object: 'response', status: 'completed', output, metadata: { ccpt_transport: 'chat-completions' },
    ...(u ? { usage: { ...(u.inputTokens === undefined ? {} : { input_tokens: u.inputTokens }), ...(u.outputTokens === undefined ? {} : { output_tokens: u.outputTokens }),
      ...(u.inputTokens !== undefined && u.outputTokens !== undefined ? { total_tokens: u.inputTokens + u.outputTokens } : {}),
      ...(u.cacheReadTokens === undefined ? {} : { input_tokens_details: { cached_tokens: u.cacheReadTokens } }) } } : {}) };
}
