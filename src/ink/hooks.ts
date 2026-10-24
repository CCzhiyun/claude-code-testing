export interface Disposable { dispose(): void }
export function onProcessResize(listener: (width: number, height: number) => void, output: NodeJS.WriteStream = process.stdout): Disposable {
  const handler = (): void => listener(output.columns || 80, output.rows || 24);
  output.on('resize', handler); return { dispose: () => output.off('resize', handler) };
}

export class RenderScheduler {
  #pending = false;
  constructor(readonly render: () => void) {}
  request(): void { if (this.#pending) return; this.#pending = true; queueMicrotask(() => { this.#pending = false; this.render(); }); }
  get pending(): boolean { return this.#pending; }
}
