import type { PermissionBehavior, PermissionRule } from './PermissionRule.js';
export interface PermissionResult { behavior: PermissionBehavior; rule?: PermissionRule; subject: string; reason: string }
export function getRuleBehaviorDescription(behavior: PermissionBehavior): string { return behavior === 'allow' ? 'allowed' : behavior === 'deny' ? 'denied' : 'requires confirmation'; }
