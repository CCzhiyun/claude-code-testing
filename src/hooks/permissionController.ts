import type { PermissionMode } from '../types.js';
export interface PermissionRequestModel { id: string; tool: string; input: unknown; reason?: string }
export type PermissionResolution = { behavior: 'allow' | 'deny'; remember: boolean; reason?: string };
export class PermissionController {
  readonly #pending = new Map<string, PermissionRequestModel>();
  constructor(readonly mode: PermissionMode) {}
  request(value: PermissionRequestModel): void { if (this.#pending.has(value.id)) throw new Error(`Permission request already exists: ${value.id}`); this.#pending.set(value.id, structuredClone(value)); }
  resolve(id: string, resolution: PermissionResolution): { request: PermissionRequestModel; resolution: PermissionResolution } { const request = this.#pending.get(id); if (!request) throw new Error(`Permission request not found: ${id}`); this.#pending.delete(id); return { request, resolution }; }
  list(): PermissionRequestModel[] { return [...this.#pending.values()].map((item) => structuredClone(item)); }
}
