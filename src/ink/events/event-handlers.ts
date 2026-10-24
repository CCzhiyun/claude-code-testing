import type { TerminalEvent } from './terminal-event.js';
export const HANDLER_FOR_EVENT: Readonly<Record<string, string>> = { click: 'onClick', focus: 'onFocus', blur: 'onBlur', keyboard: 'onKeyPress', input: 'onInput', paste: 'onPaste', resize: 'onResize', 'terminal-focus': 'onTerminalFocus' };
export type EventHandler = (event: TerminalEvent) => void;
export type EventHandlerProps = Partial<Record<(typeof HANDLER_FOR_EVENT)[string], EventHandler>>;
