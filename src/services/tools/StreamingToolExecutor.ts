import type { Delegate } from '../../tooling.js';
import type { ToolContext } from '../../types.js';
import { runTools } from './toolOrchestration.js';
import type { ToolCall, ToolExecutionResult } from './toolExecution.js';
export class StreamingToolExecutor { constructor(private readonly context: ToolContext, private readonly delegate: Delegate) {} async *execute(calls: ToolCall[]): AsyncGenerator<ToolExecutionResult> { for (const result of await runTools(calls, this.context, this.delegate)) yield result; } }
