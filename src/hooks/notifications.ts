export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';
export interface NativeNotification { id: string; message: string; level: NotificationLevel; createdAt: number; expiresAt?: number; source?: string }
export class NotificationCenter {
  readonly #items = new Map<string, NativeNotification>();
  publish(notification: NativeNotification): void { if (!notification.id || !notification.message) throw new Error('Notification requires id and message'); this.#items.set(notification.id, notification); }
  dismiss(id: string): boolean { return this.#items.delete(id); }
  list(now = Date.now()): NativeNotification[] { for (const [id, item] of this.#items) if (item.expiresAt !== undefined && item.expiresAt <= now) this.#items.delete(id); return [...this.#items.values()].sort((a, b) => a.createdAt - b.createdAt); }
  clear(): void { this.#items.clear(); }
}
