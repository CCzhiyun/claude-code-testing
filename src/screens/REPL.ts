import { parseCommandLine, searchNativeCommands, type ParsedCommandLine } from '../commands/index.js';
import { InputBuffer, InputHistory } from '../hooks/index.js';
export type ReplSubmission = { type: 'command'; command: ParsedCommandLine } | { type: 'prompt'; prompt: string } | { type: 'empty' };
export class ReplScreenController {
  readonly input = new InputBuffer(); readonly history = new InputHistory();
  submit(): ReplSubmission { const value = this.input.clear(); if (!value.trim()) return { type: 'empty' }; this.history.push(value); const command = parseCommandLine(value); return command ? { type: 'command', command } : { type: 'prompt', prompt: value.trim() }; }
  suggestions(limit = 12): ReturnType<typeof searchNativeCommands> { return this.input.snapshot.text.startsWith('/') ? searchNativeCommands(this.input.snapshot.text, limit) : []; }
  previous(): void { this.input.set(this.history.previous(this.input.snapshot.text)); }
  next(): void { this.input.set(this.history.next()); }
}
