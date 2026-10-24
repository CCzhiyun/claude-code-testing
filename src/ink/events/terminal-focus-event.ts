import { TerminalEvent } from './terminal-event.js';
export class TerminalFocusEvent extends TerminalEvent { constructor(readonly focused: boolean) { super('terminal-focus', false); } }
