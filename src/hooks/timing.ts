export class DoublePressDetector {
  #last = Number.NEGATIVE_INFINITY;
  constructor(readonly thresholdMs = 500) {}
  press(now = Date.now()): boolean { const matched = now - this.#last <= this.thresholdMs; this.#last = matched ? Number.NEGATIVE_INFINITY : now; return matched; }
  reset(): void { this.#last = Number.NEGATIVE_INFINITY; }
}
export class MinimumDisplayTime {
  readonly #startedAt: number;
  constructor(readonly minimumMs: number, now = Date.now()) { this.#startedAt = now; }
  remaining(now = Date.now()): number { return Math.max(0, this.minimumMs - (now - this.#startedAt)); }
}
export class BlinkController { #visible = true; constructor(readonly intervalMs = 500) {} at(now: number): boolean { return Math.floor(now / this.intervalMs) % 2 === 0; } toggle(): boolean { this.#visible = !this.#visible; return this.#visible; } }
