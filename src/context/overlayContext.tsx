export class OverlayContext<T> { private value?: T; show(value: T): void { this.value = value; } hide(): void { this.value = undefined; } get current(): T | undefined { return this.value; } }
