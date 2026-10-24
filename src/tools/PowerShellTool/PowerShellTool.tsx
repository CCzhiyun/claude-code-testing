import type { ToolContext, ToolDefinition } from '../../types.js';
import { buildTool } from '../../Tool.js';
import { executeCommand } from '../../policy.js';
import { parseSimpleCommand } from '../shellParsing.js';
import { getDestructiveCommandWarning } from './destructiveCommandWarning.js';
import { powershellCommandIsSafe } from './powershellSecurity.js';
export type PowerShellToolInput = { command: string; timeout?: number; description?: string };
export type Out = { stdout: string; stderr: string; code: number; command: string };
export function detectBlockedSleepPattern(command: string): string | null { const match = /\bstart-sleep\s+(?:-seconds\s+)?(\d+)/i.exec(command); return match?.[1] && Number(match[1]) > 60 ? 'Blocking sleeps longer than 60 seconds are not allowed.' : null; }
export async function executePowerShellTool(input: PowerShellToolInput, context: ToolContext): Promise<Out> { const blocked = detectBlockedSleepPattern(input.command); if (blocked) throw new Error(blocked); if (!powershellCommandIsSafe(input.command)) throw new Error(getDestructiveCommandWarning(input.command) ?? 'PowerShell expression is not safe for direct executable mode'); const parsed = parseSimpleCommand(input.command); const result = await executeCommand(parsed.command, parsed.args, context.cwd, context.config, context.agentId); return { ...result, command: input.command }; }
export const PowerShellTool: ToolDefinition = buildTool({ name: 'powershell', description: 'Run one allowlisted executable with PowerShell-style argument quoting; script evaluation is disabled.', input_schema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' }, description: { type: 'string' } }, required: ['command'] } });
