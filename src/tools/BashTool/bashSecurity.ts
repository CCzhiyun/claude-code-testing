import { DESTRUCTIVE_COMMANDS, parseSimpleCommand } from '../shellParsing.js';
export function stripSafeHeredocSubstitutions(command: string): string | null { return /<<[-~]?\s*['"]?[A-Za-z_][A-Za-z0-9_]*['"]?/.test(command) ? null : command; }
export function hasSafeHeredocSubstitution(command: string): boolean { return stripSafeHeredocSubstitutions(command) !== null && command.includes('<<'); }
export function bashCommandIsSafe_DEPRECATED(command: string): boolean { try { parseSimpleCommand(command); return !DESTRUCTIVE_COMMANDS.test(command); } catch { return false; } }
export async function bashCommandIsSafeAsync_DEPRECATED(command: string): Promise<boolean> { return bashCommandIsSafe_DEPRECATED(command); }
