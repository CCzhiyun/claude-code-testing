import { callModel, type ModelResponse } from '../../model.js'; import type { ModelMessage, PlatformConfig, ToolDefinition } from '../../types.js';
export const queryModelWithoutStreaming = (config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[]): Promise<ModelResponse> => callModel(config, system, messages, tools);
export async function* queryModelWithStreaming(config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[]): AsyncGenerator<ModelResponse> { yield await callModel(config, system, messages, tools); }
