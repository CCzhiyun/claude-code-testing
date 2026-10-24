export type FirstPartyEvent = { event: string; timestamp: string; metadata: Record<string, unknown> };

export class FirstPartyEventLoggingExporter {
  private queue: FirstPartyEvent[] = [];
  private flushing: Promise<void> | undefined;

  constructor(private readonly send: (events: FirstPartyEvent[]) => Promise<void>, private readonly batchSize = 50, private readonly maxQueue = 1_000) {}

  export(event: FirstPartyEvent): void {
    if (this.queue.length >= this.maxQueue) this.queue.shift();
    this.queue.push(structuredClone(event));
    if (this.queue.length >= this.batchSize) void this.forceFlush();
  }

  async forceFlush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.queue.length) {
        const batch = this.queue.splice(0, this.batchSize);
        try { await this.send(batch); }
        catch (error) { this.queue.unshift(...batch); throw error; }
      }
    })().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }

  async shutdown(): Promise<void> { await this.forceFlush(); }
  get pending(): number { return this.queue.length; }
}
