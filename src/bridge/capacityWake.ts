export class CapacityWake {
  private waiter: (() => void) | undefined;
  private signaled = false;

  wake(): void {
    this.signaled = true;
    this.waiter?.();
    this.waiter = undefined;
  }

  async wait(signal?: AbortSignal): Promise<void> {
    if (this.signaled) { this.signaled = false; return; }
    await new Promise<void>((resolve, reject) => {
      const aborted = () => { this.waiter = undefined; reject(new Error('Capacity wait aborted')); };
      if (signal?.aborted) { aborted(); return; }
      signal?.addEventListener('abort', aborted, { once: true });
      this.waiter = () => { signal?.removeEventListener('abort', aborted); this.signaled = false; resolve(); };
    });
  }
}
