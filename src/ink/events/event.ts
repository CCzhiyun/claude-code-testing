export class Event {
  defaultPrevented = false;
  propagationStopped = false;
  immediatePropagationStopped = false;
  constructor(readonly type: string, readonly timestamp = Date.now()) {}
  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.propagationStopped = true; }
  stopImmediatePropagation(): void { this.immediatePropagationStopped = true; this.propagationStopped = true; }
}
