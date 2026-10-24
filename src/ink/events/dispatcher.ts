import { HANDLER_FOR_EVENT } from './event-handlers.js';
import type { EventTarget, TerminalEvent } from './terminal-event.js';

export class Dispatcher {
  dispatch(target: EventTarget, event: TerminalEvent): boolean {
    event.target = target;
    const path = event.composedPath();
    for (const current of path) {
      event.currentTarget = current;
      const handler = current.handlers?.[HANDLER_FOR_EVENT[event.type] ?? event.type];
      handler?.(event);
      if (event.immediatePropagationStopped || event.propagationStopped || !event.bubbles) break;
    }
    return !event.defaultPrevented;
  }
}
