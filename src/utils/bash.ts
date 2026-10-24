export type ShellOperator = '|' | '||' | '&&' | ';' | '>' | '>>' | '<' | '<<' | '2>' | '2>>' | '&';
export interface ShellToken { kind: 'word' | 'operator'; value: string; quoted: boolean }
export interface ShellCommandNode { command: string; args: string[]; assignments: Record<string, string>; wrappers: string[] }
export interface ShellScript { tokens: ShellToken[]; commands: ShellCommandNode[]; operators: ShellOperator[] }
export interface HeredocBlock { delimiter: string; body: string; stripTabs: boolean }

const operators = ['2>>', '&&', '||', '>>', '<<', '2>', '|', ';', '>', '<', '&'] as const;
const wrapperArity: Record<string, number> = { command: 0, env: 0, nohup: 0, sudo: 0, time: 0, timeout: 1, srun: 0 };

function readOperator(input: string, index: number): string | undefined {
  return operators.find((operator) => input.startsWith(operator, index));
}

/** Tokenizes a portable POSIX-like shell command without executing or expanding it. */
export function tokenizeShell(input: string): ShellToken[] {
  if (input.includes('\0')) throw new Error('Shell input cannot contain NUL bytes');
  const output: ShellToken[] = [];
  let word = '';
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let quoted = false;
  const flush = (): void => { if (word || quoted) { output.push({ kind: 'word', value: word, quoted }); word = ''; quoted = false; } };
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (escaped) { word += character; escaped = false; continue; }
    if (character === '\\' && quote !== "'") { escaped = true; quoted = true; continue; }
    if (quote) {
      if (character === quote) quote = undefined;
      else word += character;
      quoted = true;
      continue;
    }
    if (character === "'" || character === '"') { quote = character; quoted = true; continue; }
    const operator = readOperator(input, index);
    if (operator) { flush(); output.push({ kind: 'operator', value: operator, quoted: false }); index += operator.length - 1; continue; }
    if (/\s/.test(character)) { flush(); continue; }
    word += character;
  }
  if (escaped || quote) throw new Error('Unterminated shell escape or quote');
  flush();
  return output;
}

function commandNode(words: string[]): ShellCommandNode {
  const assignments: Record<string, string> = {};
  const wrappers: string[] = [];
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!)) {
    const separator = words[index]!.indexOf('=');
    assignments[words[index]!.slice(0, separator)] = words[index]!.slice(separator + 1);
    index += 1;
  }
  while (index < words.length) {
    const wrapper = words[index]!.toLowerCase();
    if (!(wrapper in wrapperArity)) break;
    wrappers.push(words[index]!); index += 1 + wrapperArity[wrapper]!;
    if (wrapper === 'env') while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!)) index += 1;
  }
  return { command: words[index] ?? '', args: words.slice(index + 1), assignments, wrappers };
}

export function parseShellScript(input: string): ShellScript {
  const tokens = tokenizeShell(input);
  const commands: ShellCommandNode[] = [];
  const shellOperators: ShellOperator[] = [];
  let words: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'word') { words.push(token.value); continue; }
    if (words.length) { commands.push(commandNode(words)); words = []; }
    shellOperators.push(token.value as ShellOperator);
  }
  if (words.length) commands.push(commandNode(words));
  return { tokens, commands, operators: shellOperators };
}

export function quoteShellWord(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function shellJoin(command: string, args: readonly string[]): string { return [command, ...args].map(quoteShellWord).join(' '); }

export function extractHeredocs(input: string): HeredocBlock[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const output: HeredocBlock[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]!.match(/<<(-)?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/);
    if (!match?.[2]) continue;
    const body: string[] = [];
    const stripTabs = Boolean(match[1]);
    for (index += 1; index < lines.length; index += 1) {
      const line = stripTabs ? lines[index]!.replace(/^\t+/, '') : lines[index]!;
      if (line === match[2]) break;
      body.push(line);
    }
    output.push({ delimiter: match[2], body: body.join('\n'), stripTabs });
  }
  return output;
}

export const SHELL_COMMAND_SPECS = Object.freeze({
  alias: { acceptsCommand: true }, nohup: { backgroundSafe: true }, pyright: { languageServer: true },
  sleep: { durationArgument: 0 }, srun: { scheduler: true }, time: { wrapsCommand: true }, timeout: { wrapsCommand: true, durationArgument: 0 },
});

export function completeShellCommand(prefix: string, candidates: readonly string[], limit = 20): string[] {
  const normalized = prefix.toLowerCase();
  return [...new Set(candidates)].filter((candidate) => candidate.toLowerCase().startsWith(normalized)).sort((a, b) => a.localeCompare(b)).slice(0, Math.max(0, limit));
}
