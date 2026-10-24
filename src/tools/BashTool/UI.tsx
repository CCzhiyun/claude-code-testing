import type { BashToolInput, Out } from './BashTool.js';
export function BackgroundHint(): string { return 'Use shell_start for durable background commands.'; }
export function renderToolUseMessage(input: Partial<BashToolInput>): string { return input.description || input.command || 'Run command'; }
export function renderToolUseProgressMessage(messages: Array<{ data?: { output?: string } }>): string { return messages.at(-1)?.data?.output ?? 'Running…'; }
export function renderToolUseQueuedMessage(): string { return 'Command queued'; }
export function renderToolResultMessage(output: Out): string { return [output.stdout, output.stderr].filter(Boolean).join('\n').trim() || `Exited with code ${output.code}`; }
export function renderToolUseErrorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
