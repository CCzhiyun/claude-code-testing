import type { ModelMessage, PlatformConfig, ToolDefinition } from '../types.js';
import type { ModelResponse, ModelStreamHandlers } from '../model.js';

export interface QueryDependencies {
  callModel(config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[], stream?: ModelStreamHandlers): Promise<ModelResponse>;
  now(): number;
}

export const defaultQueryDependencies: QueryDependencies = {
  callModel: async (config, system, messages, tools, stream) => (await import('../model.js')).callModel(config, system, messages, tools, stream),
  now: () => Date.now(),
};
