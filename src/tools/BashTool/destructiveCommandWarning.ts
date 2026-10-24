import { DESTRUCTIVE_COMMANDS } from '../shellParsing.js';
export function getDestructiveCommandWarning(command: string): string | null { return DESTRUCTIVE_COMMANDS.test(command) ? 'This command may irreversibly remove data or rewrite Git history.' : null; }
