import type { PlatformConfig } from '../../types.js';
import { authorizeCommand } from '../../policy.js';
import { parseSimpleCommand } from '../shellParsing.js';
const wildcard = (value: string, pattern: string): boolean => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`, 'i').test(value);
export function powershellPermissionRule(command: string): string | null { try { return parseSimpleCommand(command).command; } catch { return null; } }
export function powershellToolCheckExactMatchPermission(command: string, rules: string[]): boolean { return rules.includes(command.trim()); }
export function powershellToolCheckPermission(command: string, rules: string[]): boolean { return rules.some((rule) => wildcard(command.trim(), rule)); }
export async function powershellToolHasPermission(command: string, config: PlatformConfig): Promise<boolean> { try { const parsed = parseSimpleCommand(command); authorizeCommand(parsed.command, parsed.args, config); return true; } catch { return false; } }
