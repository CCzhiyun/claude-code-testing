import { isSedInPlaceEdit } from './sedEditParser.js';
export function isLinePrintingCommand(command: string): boolean { return /^\s*sed\s+(?:-[nErs]+\s+)*['"]?\d*(?:,\d*)?p['"]?/i.test(command); }
export function isPrintCommand(command: string): boolean { return isLinePrintingCommand(command); }
export function sedCommandIsAllowedByAllowlist(command: string): boolean { return isLinePrintingCommand(command) && !isSedInPlaceEdit(command); }
export function hasFileArgs(command: string): boolean { return /^\s*sed\s+.+\s+[^-\s][^\s]*\s*$/.test(command); }
export function extractSedExpressions(command: string): string[] { return [...command.matchAll(/(?:-e\s+)?(['"])(.*?)\1/g)].map((match) => match[2]!).filter(Boolean); }
export function checkSedConstraints(command: string): { allowed: boolean; reason?: string } { return sedCommandIsAllowedByAllowlist(command) ? { allowed: true } : { allowed: false, reason: 'Only non-mutating sed print expressions are auto-allowed' }; }
