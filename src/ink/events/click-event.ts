import { TerminalEvent } from './terminal-event.js';
export class ClickEvent extends TerminalEvent {
  constructor(readonly x: number, readonly y: number, readonly button: 0 | 1 | 2 = 0, readonly modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) { super('click'); }
}
