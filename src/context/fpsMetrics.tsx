export class FpsMetrics {
  private frames: number[] = [];
  frame(time = performance.now()): void { this.frames.push(time); while (this.frames[0] !== undefined && time - this.frames[0] > 1_000) this.frames.shift(); }
  get fps(): number { return this.frames.length; }
}
