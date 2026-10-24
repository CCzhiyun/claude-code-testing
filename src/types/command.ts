export type CommandResultDisplay = 'skip' | 'system' | 'user';
export type LocalCommandResult = { type: 'text'; value: string } | { type: 'skip' } | { type: 'compact'; summary: string };
export interface CommandBase {
  name: string;
  description: string;
  aliases?: string[];
  argumentHint?: string;
  isHidden?: boolean;
  isEnabled?: () => boolean;
  userFacingName?: () => string;
}
export interface PromptCommand extends CommandBase { type: 'prompt'; progressMessage: string; contentLength: number; getPrompt(args: string): Promise<string> }
export interface LocalCommand extends CommandBase { type: 'local'; supportsNonInteractive: boolean; call(args: string): Promise<LocalCommandResult> }
export type Command = PromptCommand | LocalCommand;
export const getCommandName = (command: CommandBase): string => command.userFacingName?.() ?? command.name;
export const isCommandEnabled = (command: CommandBase): boolean => command.isEnabled?.() ?? true;
