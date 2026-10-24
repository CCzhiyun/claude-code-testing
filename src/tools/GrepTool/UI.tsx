import type { GrepMatch } from './GrepTool.js';
export const formatGrepResult = (matches: GrepMatch[]): string => matches.length ? matches.map((match) => `${match.path}:${match.line}:${match.text}`).join('\n') : 'No matches.';
