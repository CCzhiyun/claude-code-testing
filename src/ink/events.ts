export type TerminalEvent = { type: 'keypress'; input: string; key?: string } | { type: 'resize'; width: number; height: number } | { type: 'paste'; text: string } | { type: 'focus'; focused: boolean };
export type TerminalEventHandler = (event: TerminalEvent) => void;

export class TerminalEventBus {
  readonly #handlers = new Set<TerminalEventHandler>();
  subscribe(handler: TerminalEventHandler): () => void { this.#handlers.add(handler); return () => this.#handlers.delete(handler); }
  emit(event: TerminalEvent): void { for (const handler of [...this.#handlers]) handler(event); }
  clear(): void { this.#handlers.clear(); }
  get size(): number { return this.#handlers.size; }
}
