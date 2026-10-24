import { DESTRUCTIVE_COMMANDS } from '../shellParsing.js';
export function getDestructiveCommandWarning(command: string): string | null { return DESTRUCTIVE_COMMANDS.test(command) ? 'This PowerShell command may irreversibly delete data or rewrite Git history.' : null; }
