import { DESTRUCTIVE_COMMANDS, parseSimpleCommand } from '../shellParsing.js';
import { isClmAllowedType } from './clmTypes.js';
export function powershellCommandIsSafe(command: string): boolean { try { parseSimpleCommand(command); if (DESTRUCTIVE_COMMANDS.test(command) || /\b(?:invoke-expression|iex|add-type|start-process|set-executionpolicy)\b/i.test(command)) return false; return [...command.matchAll(/\[([\w.]+)\]/g)].every((match) => isClmAllowedType(match[1]!)); } catch { return false; } }
