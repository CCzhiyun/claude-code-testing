import type { ModelMessage, ToolDefinition } from '../types.js';
export function roughTokenCountEstimation(value: string): number { if (!value) return 0; const ascii = (value.match(/[\x00-\x7F]/g) ?? []).length; return Math.ceil(ascii / 4 + (value.length - ascii)); }
export function roughTokenCountEstimationForMessages(messages: ModelMessage[], tools: ToolDefinition[] = []): number { return messages.reduce((sum, message) => sum + roughTokenCountEstimation(typeof message.content === 'string' ? message.content : JSON.stringify(message.content)), 0) + roughTokenCountEstimation(JSON.stringify(tools)); }
export const countTokensWithAPI = async (content: string): Promise<number> => roughTokenCountEstimation(content);
