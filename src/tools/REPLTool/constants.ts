export const REPL_TOOL_NAME = 'REPL'; export function isReplModeEnabled(): boolean { return process.env.CCPT_REPL_MODE === '1'; } export const REPL_ONLY_TOOLS = new Set(['repl']);
