import { validateToolSchemas } from './toolSchema.js';

export interface McpSamplingText { type: 'text'; text: string }
export interface McpSamplingMedia { type: 'image' | 'audio'; data: string; mimeType: string }
export interface McpSamplingToolUse { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export interface McpSamplingToolResult { type: 'tool_result'; toolUseId: string; content: Array<McpSamplingText | McpSamplingMedia>; isError?: boolean }
export type McpSamplingBlock = McpSamplingText | McpSamplingMedia | McpSamplingToolUse | McpSamplingToolResult;
export interface McpModernSamplingRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: McpSamplingBlock | McpSamplingBlock[] }>;
  maxTokens: number;
  systemPrompt?: string;
  tools?: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
  toolChoice?: { mode: 'auto' | 'required' | 'none' };
}
export interface McpModernSamplingResult {
  role: 'assistant'; content: McpSamplingText | McpSamplingMedia | McpSamplingToolUse | Array<McpSamplingText | McpSamplingMedia | McpSamplingToolUse>;
  model: string; stopReason?: 'endTurn' | 'maxTokens' | 'stopSequence' | 'toolUse';
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function check(v: unknown): asserts v { if (!v) throw new Error('Invalid bounded MCP sampling content or tool sequence'); }
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v) && !['__proto__', 'prototype', 'constructor'].includes(v);
function block(value: unknown, tools: Set<string>, allowTools: boolean, nested = false): McpSamplingBlock {
  check(object(value));
  if (value.type === 'text') { check(typeof value.text === 'string' && value.text.length <= 32000); return { type: 'text', text: value.text }; }
  if (value.type === 'image' || value.type === 'audio') {
    check(typeof value.data === 'string' && value.data.length > 0 && value.data.length <= 700000 && typeof value.mimeType === 'string');
    check((value.type === 'image' ? ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] : ['audio/wav', 'audio/mpeg', 'audio/ogg', 'audio/flac']).includes(value.mimeType));
    check(/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)); const bytes = Buffer.from(value.data, 'base64'); check(bytes.length <= 512000 && bytes.toString('base64') === value.data);
    return { type: value.type, data: value.data, mimeType: value.mimeType };
  }
  check(allowTools && !nested);
  if (value.type === 'tool_use') { check(identifier(value.id) && identifier(value.name) && tools.has(value.name) && object(value.input)); return { type: 'tool_use', id: value.id, name: value.name, input: structuredClone(value.input) }; }
  check(value.type === 'tool_result' && identifier(value.toolUseId) && Array.isArray(value.content) && value.content.length <= 32 && (value.isError === undefined || typeof value.isError === 'boolean'));
  return { type: 'tool_result', toolUseId: value.toolUseId, content: value.content.map(item => block(item, tools, false, true) as McpSamplingText | McpSamplingMedia), ...(typeof value.isError === 'boolean' ? { isError: value.isError } : {}) };
}
export function parseModernSampling(value: unknown, allowTools: boolean): McpModernSamplingRequest {
  check(object(value) && Array.isArray(value.messages) && value.messages.length > 0 && value.messages.length <= 50 && Number.isSafeInteger(value.maxTokens) && Number(value.maxTokens) >= 1 && Number(value.maxTokens) <= 2048);
  check((value.includeContext === undefined || value.includeContext === 'none') && (value.systemPrompt === undefined || typeof value.systemPrompt === 'string' && value.systemPrompt.length <= 8000));
  check(value.tools === undefined || allowTools && Array.isArray(value.tools) && value.tools.length > 0 && value.tools.length <= 32);
  const names = new Set<string>();
  const tools = value.tools === undefined ? undefined : (value.tools as unknown[]).map(tool => {
    check(object(tool) && identifier(tool.name) && !names.has(tool.name) && object(tool.inputSchema) && tool.inputSchema.type === 'object' && (tool.description === undefined || typeof tool.description === 'string' && tool.description.length <= 4000));
    names.add(tool.name); return { name: tool.name, inputSchema: structuredClone(tool.inputSchema), ...(typeof tool.description === 'string' ? { description: tool.description } : {}) };
  });
  if (tools) validateToolSchemas(tools.map(tool => ({ name: tool.name, description: tool.description ?? '', input_schema: tool.inputSchema })));
  check(value.toolChoice === undefined || tools && object(value.toolChoice) && ['auto', 'required', 'none'].includes(String(value.toolChoice.mode)) && Object.keys(value.toolChoice).length === 1);
  const used = new Set<string>(); let pending = new Set<string>();
  const messages = value.messages.map(message => {
    check(object(message) && ['user', 'assistant'].includes(String(message.role)));
    const values = Array.isArray(message.content) ? message.content : [message.content]; check(values.length > 0 && values.length <= 32);
    const content = values.map(item => block(item, names, allowTools));
    const results = content.filter(item => item.type === 'tool_result');
    if (pending.size || results.length) {
      check(message.role === 'user' && pending.size > 0 && results.length === content.length && results.length === pending.size);
      for (const result of results) { check(pending.delete(result.toolUseId)); } check(pending.size === 0);
    } else {
      for (const item of content) if (item.type === 'tool_use') { check(message.role === 'assistant' && !used.has(item.id)); used.add(item.id); pending.add(item.id); }
    }
    return { role: message.role as 'user' | 'assistant', content: Array.isArray(message.content) ? content : content[0]! };
  });
  check(pending.size === 0);
  const request: McpModernSamplingRequest = { messages, maxTokens: Number(value.maxTokens), ...(typeof value.systemPrompt === 'string' ? { systemPrompt: value.systemPrompt } : {}), ...(tools ? { tools } : {}), ...(value.toolChoice ? { toolChoice: structuredClone(value.toolChoice) as McpModernSamplingRequest['toolChoice'] & {} } : {}) };
  check(Buffer.byteLength(JSON.stringify(request)) <= 750000); return request;
}
export function parseModernSamplingResult(value: unknown, request: McpModernSamplingRequest): McpModernSamplingResult {
  check(object(value) && value.role === 'assistant' && typeof value.model === 'string' && value.model.length > 0 && value.model.length <= 256 && !/[\x00-\x1f\x7f]/.test(value.model) && (value.stopReason === undefined || ['endTurn', 'maxTokens', 'stopSequence', 'toolUse'].includes(String(value.stopReason))));
  const values = Array.isArray(value.content) ? value.content : [value.content]; check(values.length > 0 && values.length <= 32);
  const names = new Set(request.tools?.map(tool => tool.name)), ids = new Set<string>();
  const previousIds=new Set(request.messages.flatMap(message=>Array.isArray(message.content)?message.content:[message.content]).filter(item=>item.type==='tool_use').map(item=>item.id));
  const content = values.map(item => { const parsed = block(item, names, !!request.tools); check(parsed.type !== 'tool_result'); if (parsed.type === 'tool_use') { check(!ids.has(parsed.id)&&!previousIds.has(parsed.id)); ids.add(parsed.id); } return parsed; });
  check(ids.size ? value.stopReason === 'toolUse' && request.toolChoice?.mode !== 'none' : value.stopReason !== 'toolUse' && request.toolChoice?.mode !== 'required');
  const result = { role: 'assistant' as const, content: Array.isArray(value.content) ? content : content[0]!, model: value.model, ...(value.stopReason ? { stopReason: value.stopReason as McpModernSamplingResult['stopReason'] & {} } : {}) };
  check(Buffer.byteLength(JSON.stringify(result)) <= 750000); return result;
}
