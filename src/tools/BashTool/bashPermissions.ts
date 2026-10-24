import type { PlatformConfig } from '../../types.js';
import { authorizeCommand } from '../../policy.js';
import { parseSimpleCommand } from '../shellParsing.js';
export const MAX_SUBCOMMANDS_FOR_SECURITY_CHECK = 50; export const MAX_SUGGESTED_RULES_FOR_COMPOUND = 5; export const BINARY_HIJACK_VARS = /^(LD_|DYLD_|PATH$)/;
export function getSimpleCommandPrefix(command: string): string | null { try { const parsed = parseSimpleCommand(command); return [parsed.command, parsed.args[0]].filter(Boolean).join(' '); } catch { return null; } }
export function getFirstWordPrefix(command: string): string | null { try { return parseSimpleCommand(command).command; } catch { return null; } }
export function matchWildcardPattern(value: string, pattern: string): boolean { const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*'); return new RegExp(`^${escaped}$`, 'i').test(value); }
export function stripSafeWrappers(command: string): string { return command.replace(/^\s*(?:env\s+(?:[A-Za-z_][A-Za-z0-9_]*=[^\s]+\s+)*|command\s+|nohup\s+)/, ''); }
export function stripWrappersFromArgv(argv: string[]): string[] { const output = [...argv]; while (['env', 'command', 'nohup'].includes(output[0]?.toLowerCase() ?? '')) output.shift(); return output; }
export function stripAllLeadingEnvVars(argv: string[]): string[] { const output = [...argv]; while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(output[0] ?? '')) output.shift(); return output; }
export function bashPermissionRule(command: string): string | null { return getFirstWordPrefix(command); }
export function bashToolCheckExactMatchPermission(command: string, rules: string[]): boolean { return rules.includes(command.trim()); }
export function bashToolCheckPermission(command: string, rules: string[]): boolean { return rules.some((rule) => matchWildcardPattern(command.trim(), rule)); }
export async function checkCommandAndSuggestRules(command: string): Promise<{ allowed: boolean; suggestions: string[] }> { const prefix = getSimpleCommandPrefix(command); return { allowed: Boolean(prefix), suggestions: prefix ? [prefix] : [] }; }
export async function bashToolHasPermission(command: string, config: PlatformConfig): Promise<boolean> { try { const parsed = parseSimpleCommand(stripSafeWrappers(command)); authorizeCommand(parsed.command, parsed.args, config); return true; } catch { return false; } }
export function isNormalizedGitCommand(command: string): boolean { try { return parseSimpleCommand(command).command.toLowerCase() === 'git'; } catch { return false; } }
export function isNormalizedCdCommand(command: string): boolean { try { return parseSimpleCommand(command).command.toLowerCase() === 'cd'; } catch { return false; } }
export function commandHasAnyCd(command: string): boolean { return /(?:^|\s)cd(?:\s|$)/i.test(command); }
export function clearSpeculativeChecks(): void {} export function peekSpeculativeClassifierCheck(): undefined { return undefined; } export function startSpeculativeClassifierCheck(): void {} export function consumeSpeculativeClassifierCheck(): undefined { return undefined; }
