import { Event } from './event.js';
export interface EventTarget { parent?: EventTarget; handlers?: Readonly<Record<string, (event: TerminalEvent) => void>> }
export class TerminalEvent extends Event {
  target?: EventTarget;
  currentTarget?: EventTarget;
  constructor(type: string, readonly bubbles = true) { super(type); }
  composedPath(): EventTarget[] { const path: EventTarget[] = []; let current = this.target; while (current) { path.push(current); current = current.parent; } return path; }
}
