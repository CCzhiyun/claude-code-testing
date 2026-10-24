import { parseSimpleCommand } from '../shellParsing.js';
export type CommandIdentityCheckers = { isGit?: (argv: string[]) => boolean; isCd?: (argv: string[]) => boolean };
export async function checkCommandOperatorPermissions(command: string): Promise<{ allowed: boolean; reason?: string }> { try { parseSimpleCommand(command); return { allowed: true }; } catch (error) { return { allowed: false, reason: error instanceof Error ? error.message : String(error) }; } }
export const splitCommand = parseSimpleCommand;
