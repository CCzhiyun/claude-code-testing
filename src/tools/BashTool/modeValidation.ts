import type { PlatformConfig } from '../../types.js';
import { parseSimpleCommand } from '../shellParsing.js';
import { authorizeCommand } from '../../policy.js';
export function checkPermissionMode(command: string, config: PlatformConfig): { allowed: boolean; reason?: string } { try { const parsed = parseSimpleCommand(command); authorizeCommand(parsed.command, parsed.args, config); return { allowed: true }; } catch (error) { return { allowed: false, reason: error instanceof Error ? error.message : String(error) }; } }
export function getAutoAllowedCommands(config: PlatformConfig): string[] { return [...config.policy.allowedCommands]; }
