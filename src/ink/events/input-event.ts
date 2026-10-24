import { TerminalEvent } from './terminal-event.js';
export class InputEvent extends TerminalEvent {
  constructor(readonly inputType: 'insertText' | 'insertLineBreak' | 'deleteContentBackward' | 'deleteContentForward' | 'insertFromPaste', readonly data = '') { super('input'); }
}
export class PasteEvent extends TerminalEvent { constructor(readonly text: string) { super('paste'); } }
export class ResizeEvent extends TerminalEvent { constructor(readonly width: number, readonly height: number) { super('resize', false); } }
