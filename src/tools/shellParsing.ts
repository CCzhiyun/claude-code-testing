export type ParsedCommand = { command: string; args: string[] };

export function parseSimpleCommand(input: string): ParsedCommand {
  if (!input.trim()) throw new Error('Command cannot be empty');
  if (/[;&|`<>\r\n]/.test(input)) throw new Error('Compound commands and shell operators are not supported; use one executable invocation');
  const words: string[] = []; let current = ''; let quote: '"' | "'" | undefined; let escaped = false;
  for (const character of input.trim()) {
    if (escaped) { current += character; escaped = false; continue; }
    if (character === '\\' && quote !== "'") { escaped = true; continue; }
    if (quote) { if (character === quote) quote = undefined; else current += character; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (/\s/.test(character)) { if (current) { words.push(current); current = ''; } continue; }
    current += character;
  }
  if (escaped || quote) throw new Error('Unterminated command escape or quote');
  if (current) words.push(current);
  if (!words[0]) throw new Error('Command cannot be empty');
  return { command: words[0], args: words.slice(1) };
}

export function commandName(input: string): string { return parseSimpleCommand(input).command.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase(); }
export const READ_ONLY_COMMANDS = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'find', 'ls', 'dir', 'pwd', 'git', 'node', 'npm', 'bun', 'get-childitem', 'get-content', 'select-string', 'resolve-path', 'test-path']);
export const DESTRUCTIVE_COMMANDS = /\b(rm|rmdir|del|erase|remove-item|format|mkfs|diskpart|clear-disk|git\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+.*--force))\b/i;
