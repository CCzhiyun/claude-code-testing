import packageMetadata from '../../package.json' with { type: 'json' };
import { CLI_VALUE_OPTIONS } from '../cliOptions.js';
export interface CliInvocation { command: string; args: string[]; options: Readonly<Record<string, string | boolean>> }
const optionsWithValues = new Set<string>(CLI_VALUE_OPTIONS);
const aliases: Record<string, string> = { '-c': '--continue', '-r': '--resume', '-h': '--help', '-v': '--version', '-p': '--print' };
export function parseCliInvocation(argv: readonly string[]): CliInvocation {
  const options: Record<string, string | boolean> = {}, positional: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const value = aliases[argv[index]!] ?? argv[index]!;
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const name = value.slice(2), next = argv[index + 1];
    if (name === 'resume' && (next === undefined || next.startsWith('-'))) { options[name] ??= true; continue; }
    if (optionsWithValues.has(name)) {
      if (next === undefined || next.startsWith('--')) throw new Error(`Option --${name} requires a value`);
      options[name] ??= next; index++;
    } else options[name] ??= true;
  }
  return options.print ? { command: 'print', args: positional, options } : { command: positional.shift() ?? 'tui', args: positional, options };
}
export const CLI_VERSION = packageMetadata.version;
