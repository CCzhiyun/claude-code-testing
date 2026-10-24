import { TerminalEvent } from './terminal-event.js';
export class FocusEvent extends TerminalEvent { constructor(readonly focused: boolean) { super(focused ? 'focus' : 'blur', false); } }
