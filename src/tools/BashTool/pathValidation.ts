import { resolve } from 'node:path';
import type { PlatformConfig } from '../../types.js';
import { protectPath } from '../../policy.js';
import { parseSimpleCommand } from '../shellParsing.js';
export type PathCommand = 'cat' | 'cp' | 'find' | 'grep' | 'head' | 'ls' | 'mkdir' | 'mv' | 'rm' | 'tail' | 'touch';
export const COMMAND_OPERATION_TYPE: Record<PathCommand, 'read' | 'write' | 'delete'> = { cat: 'read', cp: 'write', find: 'read', grep: 'read', head: 'read', ls: 'read', mkdir: 'write', mv: 'write', rm: 'delete', tail: 'read', touch: 'write' };
export const PATH_EXTRACTORS: Partial<Record<PathCommand, (args: string[]) => string[]>> = {};
export function stripWrappersFromArgv(argv: string[]): string[] { return argv.filter((value, index) => index > 0 || !['env', 'command'].includes(value)); }
export function createPathChecker(cwd: string, config: PlatformConfig): (path: string) => string { return (path) => protectPath(resolve(cwd, path), config); }
export function checkPathConstraints(command: string, cwd: string, config: PlatformConfig): { allowed: boolean; paths: string[]; reason?: string } { try { const parsed = parseSimpleCommand(command); const paths = parsed.args.filter((arg) => !arg.startsWith('-') && (arg.includes('/') || arg.includes('\\') || arg.startsWith('.'))).map((path) => protectPath(resolve(cwd, path), config)); return { allowed: true, paths }; } catch (error) { return { allowed: false, paths: [], reason: error instanceof Error ? error.message : String(error) }; } }
