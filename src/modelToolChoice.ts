import { AsyncLocalStorage } from 'node:async_hooks';
import type { ContentBlock, ToolDefinition } from './types.js';

export type ModelToolChoice = 'auto' | 'none' | 'required';
const choice = new AsyncLocalStorage<ModelToolChoice>();
/** Invocation-local; never store a sampling server's choice on shared settings. */
export function withModelToolChoice<T>(mode: ModelToolChoice, action: () => T): T {
  if (!['auto', 'none', 'required'].includes(mode)) throw new Error('Invalid model tool choice');
  return choice.run(mode, action);
}
export function modelToolChoiceFields(): { tool_choice?: ModelToolChoice } {
  const mode = choice.getStore();
  return mode === undefined ? {} : { tool_choice: mode };
}
export function validateModelToolChoice(protocol: string, tools: ToolDefinition[]): void {
  const mode = choice.getStore();
  if (mode && mode !== 'auto' && !['responses', 'chat-completions'].includes(protocol)) throw new Error('Explicit tool choice requires Responses or Chat Completions');
  if (mode === 'required' && !tools.length) throw new Error('Required tool choice needs at least one tool');
}
export function validateToolChoiceResult(content: ContentBlock[], tools: ToolDefinition[]): void {
  const mode = choice.getStore();
  if (mode === undefined) return;
  const calls = content.filter(block => block.type === 'tool_use');
  if (mode === 'required' && !calls.length) throw new Error('Provider ignored required tool choice; sampling result not shared');
  if (mode === 'none' && calls.length) throw new Error('Provider returned a tool despite tool_choice=none');
  if (calls.some(call => !tools.some(tool => tool.name === call.name))) throw new Error('Provider returned an undeclared sampling tool');
}
