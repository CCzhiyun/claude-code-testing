import type { Delegate, ToolResult } from '../../tooling.js';
import { executeTool } from '../../tooling.js';
import type { ToolContext } from '../../types.js';
export interface ToolCall { id: string; name: string; input: Record<string, unknown> }
export interface ToolExecutionResult { id: string; name: string; result?: ToolResult; error?: string; durationMs: number }
export async function executeToolCall(call: ToolCall, context: ToolContext, delegate: Delegate): Promise<ToolExecutionResult> { const started = Date.now(); try { return { id: call.id, name: call.name, result: await executeTool(call.name, call.input, context, delegate), durationMs: Date.now() - started }; } catch (error) { return { id: call.id, name: call.name, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started }; } }
