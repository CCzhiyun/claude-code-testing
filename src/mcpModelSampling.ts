import { randomUUID } from 'node:crypto';
import type { ContentBlock, ModelMessage, PlatformConfig } from './types.js';
import type { McpInteractionHandlers } from './mcpInteraction.js';
import type { McpModernSamplingRequest, McpModernSamplingResult, McpSamplingBlock } from './mcpSamplingModern.js';
import { callModel } from './model.js';
import { withExecutionSignal } from './executionControl.js';
import { currentSpendScope, readSpending, withSpendScope } from './spending.js';
import { parseModernSampling } from './mcpSamplingModern.js';
import { withModelToolChoice } from './modelToolChoice.js';

export interface McpSamplingBudget { maxRequests: number; maxReservedTokens: number; tools?: boolean;audio?:boolean }
export function validateMcpSamplingBudget(value: McpSamplingBudget): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['maxRequests','maxReservedTokens','tools','audio'].includes(key))
    || !Number.isSafeInteger(value.maxRequests) || value.maxRequests < 1 || value.maxRequests > 100
    || !Number.isSafeInteger(value.maxReservedTokens) || value.maxReservedTokens < 1 || value.maxReservedTokens > 1_000_000_000
    || value.tools !== undefined && typeof value.tools !== 'boolean'||value.audio!==undefined&&typeof value.audio!=='boolean') throw new Error('MCP samplingBudget requires maxRequests 1–100 and maxReservedTokens 1–1000000000');
}
/** Model sampling only: server-defined tools are returned to the server, NEVER
 * executed locally. No current chat, local Skills, filesystem or MCP recursion. */
export function createMcpModelSampling(config: PlatformConfig, budget: McpSamplingBudget, approve: (phase: 'request' | 'share', value: unknown, signal: AbortSignal) => Promise<boolean>, options: { tools?: boolean;audio?:boolean } = {}) {
  validateMcpSamplingBudget(budget);
  budget = structuredClone(budget); options = { ...options };
  if (config.policy.mode === 'restricted') throw new Error('MCP model sampling disabled in restricted mode');
  if (options.tools && budget.tools !== true) throw new Error('MCP sampling tools require explicit server samplingBudget.tools=true');
  if(options.audio&&budget.audio!==true)throw new Error('MCP audio requires explicit server samplingBudget.audio=true');
  const scope = `mcp-sampling-${randomUUID()}`;
  let boundScope: string | undefined;
  const execute = async (request: McpModernSamplingRequest, signal: AbortSignal): Promise<McpModernSamplingResult> => {
    signal.throwIfAborted();
    if (config.policy.mode === 'restricted') throw new Error('MCP model sampling permission was revoked');
    // A parent Agent's budget must not be escaped. Bind on first execution and
    // reject reuse across unrelated ledgers; status reports the actual ledger.
    const executionScope = currentSpendScope() ?? scope;
    if (boundScope !== undefined && boundScope !== executionScope) throw new Error('MCP sampling cannot switch its bound spending scope');
    boundScope = executionScope;
    request = parseModernSampling(request, options.tools === true);
    const messages: ModelMessage[] = request.messages.map(message => {
      const values = Array.isArray(message.content) ? message.content : [message.content];
      const convert = (block: McpSamplingBlock): ContentBlock => {
        if (block.type === 'text') return { type: 'text', text: block.text };
        if (block.type === 'image') return { type: 'image', data: block.data, media_type: block.mimeType };
        if (block.type === 'audio') {if(!options.audio)throw new Error('Audio sampling is not enabled for this invocation');return {type:'audio',data:block.data,media_type:block.mimeType};}
        if (block.type === 'tool_use') return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        if (block.type !== 'tool_result') throw new Error('Unsupported sampling block');
        if (block.content.some(item => item.type !== 'text')) throw new Error('Sampling tool results must be text for this adapter');
        return { type: 'tool_result', tool_use_id: block.toolUseId, content: block.content.map(item => item.type === 'text' ? item.text : '').join('\n'), is_error: block.isError === true };
      };
      return { role: message.role, content: values.map(convert) };
    });
    if (request.tools?.length && !options.tools) throw new Error('Sampling tools are not enabled for this invocation');
    const isolated = structuredClone(config); isolated.hooks = []; isolated.model.responsesStore = false;
    isolated.model.maxOutputTokens = Math.min(request.maxTokens, config.model.maxOutputTokens);
    isolated.spending = { ...config.spending, maxRequests: Math.min(budget.maxRequests, config.spending?.maxRequests ?? Infinity), maxTokens: Math.min(budget.maxReservedTokens, config.spending?.maxTokens ?? Infinity) };
    const tools = request.toolChoice?.mode === 'none' ? [] : (request.tools ?? []).map(tool => ({ name: tool.name, description: tool.description ?? '', input_schema: tool.inputSchema }));
    const result = await withSpendScope(boundScope, () => withModelToolChoice(request.toolChoice?.mode ?? 'auto', () => withExecutionSignal(signal, () => callModel(isolated, request.systemPrompt ?? '', messages, tools))));
    const content: Array<import('./mcpSamplingModern.js').McpSamplingText | import('./mcpSamplingModern.js').McpSamplingToolUse> = [];
    for (const block of result.content) {
      if (block.type === 'text' && block.text) content.push({ type: 'text', text: block.text });
      if (block.type === 'tool_use') content.push({ type: 'tool_use', id: block.id!, name: block.name!, input: block.input ?? {} });
    }
    return { role: 'assistant', content: content.length ? content : { type: 'text', text: '' }, model: config.model.name, stopReason: result.content.some(block => block.type === 'tool_use') ? 'toolUse' : result.stopReason === 'max_tokens' ? 'maxTokens' : 'endTurn' };
  };
  const handlers: McpInteractionHandlers = {
    confirmSampling: (request, signal) => approve('request', request, signal),
    sample: async (request, signal) => {
      const result = await execute(request, signal), values = Array.isArray(result.content) ? result.content : [result.content];
      if (values.some(block => block.type !== 'text')) throw new Error('Legacy sampling returned non-text content');
      return { role: 'assistant', content: { type: 'text', text: values.map(block => block.type === 'text' ? block.text : '').join('\n') }, model: result.model, stopReason: result.stopReason === 'maxTokens' ? 'maxTokens' : 'endTurn' };
    },
    confirmSamplingResult: (result, _request, signal) => approve('share', result, signal),
    ...(options.tools||options.audio ? {
      samplingTools: options.tools===true,
      confirmModernSampling: (request: McpModernSamplingRequest, signal: AbortSignal) => approve('request', request, signal),
      sampleModern: execute,
      confirmModernSamplingResult: (result: McpModernSamplingResult, _request: McpModernSamplingRequest, signal: AbortSignal) => approve('share', result, signal),
    } : {}),
  };
  return { handlers, status: () => readSpending(boundScope ?? scope) };
}
