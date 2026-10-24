import type { ContentBlock, ModelMessage } from '../types.js';

export function adaptRemoteSdkMessage(value: unknown): ModelMessage {
  if (!value || typeof value !== 'object') throw new Error('Remote SDK message must be an object');
  const message = value as Record<string, unknown>;
  if (message.role !== 'user' && message.role !== 'assistant') throw new Error('Remote SDK message has an invalid role');
  if (typeof message.content === 'string') return { role: message.role, content: message.content };
  if (!Array.isArray(message.content)) throw new Error('Remote SDK message content must be text or blocks');
  return { role: message.role, content: message.content.map(adaptBlock) };
}

function adaptBlock(value: unknown): ContentBlock {
  if (!value || typeof value !== 'object') throw new Error('Remote content block must be an object');
  const block = value as Record<string, unknown>;
  if (!['text', 'tool_use', 'tool_result'].includes(String(block.type))) throw new Error(`Unsupported remote content block: ${String(block.type)}`);
  if (block.type === 'text') {
    if (typeof block.text !== 'string') throw new Error('Text block is missing text');
    return { type: 'text', text: block.text };
  }
  if (block.type === 'tool_use') {
    if (typeof block.id !== 'string' || typeof block.name !== 'string' || !block.input || typeof block.input !== 'object') throw new Error('Malformed tool_use block');
    return { type: 'tool_use', id: block.id, name: block.name, input: block.input as Record<string, unknown> };
  }
  if (typeof block.tool_use_id !== 'string' || typeof block.content !== 'string') throw new Error('Malformed tool_result block');
  return { type: 'tool_result', tool_use_id: block.tool_use_id, content: block.content, ...(typeof block.is_error === 'boolean' ? { is_error: block.is_error } : {}) };
}
