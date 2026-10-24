import type { PermissionMode } from '../types.js';
export type PermissionBehavior = 'allow' | 'ask' | 'deny';
export interface PermissionUpdate { mode?: PermissionMode; addRules?: Partial<Record<PermissionBehavior, string[]>>; removeRules?: Partial<Record<PermissionBehavior, string[]>> }
export interface PermissionDecision { behavior: PermissionBehavior; reason: string; rule?: string }
