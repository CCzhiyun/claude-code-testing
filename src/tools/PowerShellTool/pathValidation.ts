import { resolve } from 'node:path';
import type { PlatformConfig } from '../../types.js';
import { protectPath } from '../../policy.js';
import { parseSimpleCommand } from '../shellParsing.js';
export function isDangerousRemovalRawPath(filePath: string): boolean { const value = filePath.replace(/^['"]|['"]$/g, '').replaceAll('/', '\\').toLowerCase(); return /^[a-z]:\\?$/.test(value) || value === '\\' || value.endsWith('\\.git') || value.includes('\\.git\\'); }
export function dangerousRemovalDeny(path: string): { behavior: 'deny'; reason: string } { return { behavior: 'deny', reason: `Dangerous recursive removal target: ${path}` }; }
export function checkPathConstraints(command: string, cwd: string, config: PlatformConfig): { allowed: boolean; paths: string[]; reason?: string } { try { const parsed = parseSimpleCommand(command); const paths = parsed.args.filter((arg) => !arg.startsWith('-') && (arg.includes('\\') || arg.includes('/') || arg.startsWith('.'))).map((path) => protectPath(resolve(cwd, path), config)); if (/^(remove-item|del|erase)$/i.test(parsed.command) && paths.some(isDangerousRemovalRawPath)) return { allowed: false, paths, reason: 'Dangerous removal path' }; return { allowed: true, paths }; } catch (error) { return { allowed: false, paths: [], reason: error instanceof Error ? error.message : String(error) }; } }
