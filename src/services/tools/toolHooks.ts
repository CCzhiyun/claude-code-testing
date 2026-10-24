import { runHooks } from '../../hooks.js';
import type { ToolContext } from '../../types.js';
import type { ToolCall, ToolExecutionResult } from './toolExecution.js';
export async function beforeToolCall(call: ToolCall, context: ToolContext): Promise<ToolCall> { const result = await runHooks(context.config, 'PreToolUse', { tool_name: call.name, tool_input: call.input, tool_use_id: call.id }, context.cwd); return { ...call, input: { ...call.input, ...(result.updatedInput ?? {}) } }; }
export async function afterToolCall(call: ToolCall, result: ToolExecutionResult, context: ToolContext): Promise<void> { await runHooks(context.config, result.error ? 'PostToolUseFailure' : 'PostToolUse', { tool_name: call.name, tool_input: call.input, tool_use_id: call.id, result: result.result, error: result.error }, context.cwd); }
