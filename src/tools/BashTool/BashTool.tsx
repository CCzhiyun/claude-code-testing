import type { ToolContext, ToolDefinition } from '../../types.js';
import { buildTool } from '../../Tool.js';
import { executeCommand } from '../../policy.js';
import { parseSimpleCommand } from '../shellParsing.js';
import { isCommandSafeViaFlagParsing } from './readOnlyValidation.js';
import { getDestructiveCommandWarning } from './destructiveCommandWarning.js';

export type BashToolInput = { command: string; timeout?: number; description?: string };
export type Out = { stdout: string; stderr: string; code: number; command: string; warning?: string };
export function isSearchOrReadBashCommand(command: string): { isReadOnly: boolean; command?: string } { try { return { isReadOnly: isCommandSafeViaFlagParsing(command), command: parseSimpleCommand(command).command }; } catch { return { isReadOnly: false }; } }
export function detectBlockedSleepPattern(command: string): string | null { const match = /(?:^|\s)sleep\s+(\d+)(?:s)?(?:\s|$)/i.exec(command); return match?.[1] && Number(match[1]) > 60 ? 'Blocking sleeps longer than 60 seconds are not allowed.' : null; }
export async function executeBashTool(input: BashToolInput, context: ToolContext): Promise<Out> { const blocked = detectBlockedSleepPattern(input.command); if (blocked) throw new Error(blocked); const parsed = parseSimpleCommand(input.command.replace(/^\s*#.*\r?\n/, '')); const warning = getDestructiveCommandWarning(input.command); if (warning && context.config.policy.mode !== 'bypass') throw new Error(warning); const result = await executeCommand(parsed.command, parsed.args, context.cwd, context.config, context.agentId); return { ...result, command: input.command, ...(warning ? { warning } : {}) }; }
export const BashTool: ToolDefinition = buildTool({ name: 'bash', description: 'Run one allowlisted executable using Bash-style quoting without invoking a shell.', input_schema: { type: 'object', properties: { command: { type: 'string' }, timeout: { type: 'number' }, description: { type: 'string' } }, required: ['command'] } });
