import type { ModelMessage, PlatformConfig, ToolDefinition } from './types.js';
import type { ModelResponse, ModelStreamHandlers } from './model.js';
import { defaultQueryDependencies, type QueryDependencies } from './query/deps.js';
import { recordQuery } from './bootstrap/state.js';
import { estimateModelOutput } from './textTokenizer.js';
import { preparedProviderInput } from './inputTokenCounting.js';
import { contextLimits, estimateContextInput } from './contextBudget.js';
import { ContextLimitError } from './modelErrors.js';

export interface QueryMetrics {
  turns: number;
  estimatedInputTokens: number;
  outputTokens: number;
  startedAt: number;
  lastResponseAt?: number;
}

/** Model-query boundary shared by CLI, SDK, and agent entrypoints. */
export class QueryEngine {
  readonly metrics: QueryMetrics;
  readonly #config: PlatformConfig;
  readonly #dependencies: QueryDependencies;
  #stopped = false;

  constructor(config: PlatformConfig, dependencies: QueryDependencies = defaultQueryDependencies) {
    this.#config = config;
    this.#dependencies = dependencies;
    this.metrics = { turns: 0, estimatedInputTokens: 0, outputTokens: 0, startedAt: dependencies.now() };
  }

  stop(): void { this.#stopped = true; }

  async query(system: string, messages: ModelMessage[], tools: ToolDefinition[], stream?: ModelStreamHandlers): Promise<ModelResponse> {
    if (this.#stopped) throw new Error('Query engine has been stopped');
    const reported = preparedProviderInput(this.#config,system,messages,tools);
    const estimated = reported ?? estimateContextInput(system, messages, tools,this.#config.model);
    const { inputBudget, outputReserve, safetyReserve } = contextLimits(this.#config.model);
    if (estimated > inputBudget) throw new ContextLimitError(`Query exceeds configured context input budget: ~${estimated} > ${inputBudget} tokens (window ${this.#config.model.maxContextTokens}, output reserve ${outputReserve}, safety reserve ${safetyReserve}). Reduce the current request/tool output, disable unused extensions, or select a larger supported context window. The latest user turn was not silently truncated.`, 'local');
    this.metrics.turns += 1;
    this.metrics.estimatedInputTokens = estimated;
    const startedAt = this.#dependencies.now();
    const response = await this.#dependencies.callModel(this.#config, system, messages, tools, stream);
    this.metrics.outputTokens += response.usage?.outputTokens ?? estimateModelOutput(this.#config.model,response.content);
    recordQuery(this.#dependencies.now() - startedAt);
    this.metrics.lastResponseAt = this.#dependencies.now();
    return response;
  }
}
