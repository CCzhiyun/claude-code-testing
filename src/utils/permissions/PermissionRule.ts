export type PermissionBehavior = 'allow' | 'ask' | 'deny';
export interface PermissionRuleValue { toolName: string; ruleContent?: string }
export interface PermissionRule extends PermissionRuleValue { behavior: PermissionBehavior; source: string; index: number }
