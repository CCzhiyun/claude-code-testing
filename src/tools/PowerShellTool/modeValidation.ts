import type { PlatformConfig } from '../../types.js';
import { authorizeCommand } from '../../policy.js';
import { parseSimpleCommand } from '../shellParsing.js';
export function isSymlinkCreatingCommand(command: { name?: string; args?: string[] }): boolean { return /^(new-item|mklink)$/i.test(command.name ?? '') && (command.args ?? []).some((arg) => /symboliclink|junction/i.test(arg)); }
export function checkPermissionMode(command: string, config: PlatformConfig): { allowed: boolean; reason?: string } { try { const parsed = parseSimpleCommand(command); authorizeCommand(parsed.command, parsed.args, config); return { allowed: true }; } catch (error) { return { allowed: false, reason: error instanceof Error ? error.message : String(error) }; } }
