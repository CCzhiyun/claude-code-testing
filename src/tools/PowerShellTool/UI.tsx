import type { Out, PowerShellToolInput } from './PowerShellTool.js';
export function renderToolUseMessage(input: Partial<PowerShellToolInput>): string { return input.description || input.command || 'Run PowerShell command'; }
export function renderToolUseProgressMessage(messages: Array<{ data?: { output?: string } }>): string { return messages.at(-1)?.data?.output ?? 'Running…'; }
export function renderToolUseQueuedMessage(): string { return 'PowerShell command queued'; }
export function renderToolResultMessage(output: Out): string { return [output.stdout, output.stderr].filter(Boolean).join('\n').trim() || `Exited with code ${output.code}`; }
export function renderToolUseErrorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
