export class FlushGate<T> {
  private active = false;
  private deactivated = false;
  private queue: T[] = [];

  start(): void {
    if (this.deactivated) throw new Error('Flush gate is deactivated');
    this.active = true;
  }

  enqueue(value: T): boolean {
    if (this.deactivated) return false;
    if (!this.active) return false;
    this.queue.push(value);
    return true;
  }

  end(): T[] {
    const values = this.queue;
    this.queue = [];
    this.active = false;
    return values;
  }

  drop(): void { this.queue = []; this.active = false; }
  deactivate(): void { this.drop(); this.deactivated = true; }
  get size(): number { return this.queue.length; }
}
