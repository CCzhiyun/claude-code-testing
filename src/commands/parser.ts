import { resolveNativeCommand, type NativeCommandDefinition } from './catalog.js';

export interface ParsedCommandLine { raw: string; name: string; args: string; argv: string[]; definition?: NativeCommandDefinition }

export function splitCommandArguments(value: string): string[] {
  const output: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  for (const character of value.trim()) {
    if (escaped) { current += character; escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) { if (character === quote) quote = undefined; else current += character; continue; }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (/\s/.test(character)) { if (current) { output.push(current); current = ''; } continue; }
    current += character;
  }
  if (escaped) current += '\\';
  if (quote) throw new Error(`Unclosed ${quote} quote in command`);
  if (current) output.push(current);
  return output;
}

export function parseCommandLine(raw: string): ParsedCommandLine | undefined {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const separator = trimmed.search(/\s/);
  const typedName = (separator < 0 ? trimmed : trimmed.slice(0, separator)).toLowerCase();
  const args = separator < 0 ? '' : trimmed.slice(separator).trim();
  const definition = resolveNativeCommand(typedName);
  return { raw, name: definition?.name ?? typedName, args, argv: splitCommandArguments(args), ...(definition ? { definition } : {}) };
}
