import { TerminalEvent } from './terminal-event.js';
export interface KeyboardModifiers { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }
export class KeyboardEvent extends TerminalEvent {
  constructor(readonly key: string, readonly sequence: string, readonly modifiers: KeyboardModifiers = {}, readonly repeat = false) { super('keyboard'); }
}
