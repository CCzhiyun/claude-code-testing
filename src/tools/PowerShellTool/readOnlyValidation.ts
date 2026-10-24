import { parseSimpleCommand } from '../shellParsing.js';
export type CommandConfig = { readOnly: boolean };
export const CMDLET_ALLOWLIST: Record<string, CommandConfig> = { 'get-childitem': { readOnly: true }, 'get-content': { readOnly: true }, 'select-string': { readOnly: true }, 'test-path': { readOnly: true }, 'resolve-path': { readOnly: true }, 'get-item': { readOnly: true }, 'get-command': { readOnly: true }, 'get-location': { readOnly: true } };
const ALIASES: Record<string, string> = { dir: 'get-childitem', ls: 'get-childitem', cat: 'get-content', gc: 'get-content', pwd: 'get-location' };
export function argLeaksValue(arg: string): boolean { return /(?:password|token|secret|credential)/i.test(arg); }
export function resolveToCanonical(name: string): string { const value = name.toLowerCase(); return ALIASES[value] ?? value; }
export function isCwdChangingCmdlet(name: string): boolean { return ['set-location', 'cd', 'sl', 'push-location', 'pop-location'].includes(name.toLowerCase()); }
export function isSafeOutputCommand(name: string): boolean { return ['out-string', 'format-table', 'format-list', 'select-object', 'where-object', 'sort-object'].includes(resolveToCanonical(name)); }
export function isAllowlistedPipelineTail(name: string): boolean { return isSafeOutputCommand(name); }
export function isProvablySafeStatement(statement: { command?: string; args?: string[] }): boolean { const name = resolveToCanonical(statement.command ?? ''); return CMDLET_ALLOWLIST[name]?.readOnly === true && !(statement.args ?? []).some(argLeaksValue); }
export function hasSyncSecurityConcerns(command: string): boolean { return /[;&|`<>\r\n]|\b(?:invoke-expression|start-process|remove-item|set-content|add-content)\b/i.test(command); }
export function isReadOnlyCommand(command: string): boolean { try { const parsed = parseSimpleCommand(command); return isProvablySafeStatement({ command: parsed.command, args: parsed.args }); } catch { return false; } }
export function isAllowlistedCommand(command: string): boolean { return isReadOnlyCommand(command); }
