import { parseShellScript } from '../bash.js';

export type CommandRisk = 'allow' | 'ask' | 'deny';
export interface CommandClassification { behavior: CommandRisk; reason: string; executable?: string }

const destructive = /^(?:rm|rmdir|del|erase|remove-item|format|mkfs|diskpart|clear-disk|shutdown|reboot)$/i;
const credentialTarget = /(?:^|[\\/])(?:\.ssh|\.aws|\.azure|\.env|credentials?)(?:[\\/]|$)/i;
const remoteInstaller = /^(?:curl|wget|invoke-webrequest|irm|iwr)$/i;

export function classifyShellCommand(input: string): CommandClassification {
  let script;
  try { script = parseShellScript(input); }
  catch (error) { return { behavior: 'deny', reason: error instanceof Error ? error.message : String(error) }; }
  if (!script.commands.length) return { behavior: 'deny', reason: 'No executable command was found.' };
  if (script.operators.some((operator) => [';', '&&', '||', '|', '>', '>>', '<', '<<', '2>', '2>>'].includes(operator))) return { behavior: 'ask', reason: 'Compound commands, pipelines and redirections require confirmation.' };
  const command = script.commands[0]!;
  const executable = command.command.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '');
  if (destructive.test(executable)) return { behavior: 'deny', reason: `Destructive executable ${executable} is blocked.`, executable };
  if (command.args.some((argument) => credentialTarget.test(argument))) return { behavior: 'deny', reason: 'Command targets a protected credential path.', executable };
  if (/^git$/i.test(executable) && /^(?:push|clean|reset)$/i.test(command.args[0] ?? '')) return { behavior: 'ask', reason: `Git ${command.args[0]} changes shared or recoverable state.`, executable };
  if (remoteInstaller.test(executable)) return { behavior: 'ask', reason: 'Network download commands require destination review.', executable };
  return { behavior: 'allow', reason: 'Single non-destructive command.', executable };
}

export function yoloClassifier(input: string): CommandClassification { const result = classifyShellCommand(input); return result.behavior === 'ask' ? { ...result, behavior: 'allow', reason: `Auto mode accepted: ${result.reason}` } : result; }
