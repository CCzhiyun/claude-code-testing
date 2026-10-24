import type { Input, Output } from './ConfigTool.js';
export function renderToolUseMessage(input: Partial<Input>): string { return `${input.action ?? 'get'} config ${input.key ?? ''}`.trim(); }
export function renderToolResultMessage(output: Output): string { return `${output.key}=${JSON.stringify(output.value)}${output.updated ? ' (updated)' : ''}`; }
export function renderToolUseRejectedMessage(): string { return 'Configuration change rejected'; }
