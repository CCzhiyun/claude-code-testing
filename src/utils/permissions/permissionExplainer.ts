import type { PermissionResult } from './PermissionResult.js';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export interface PermissionExplanation { riskLevel: RiskLevel; explanation: string; reasoning: string; risk: string }
export function explainPermission(result: PermissionResult): PermissionExplanation {
  const highRisk = result.behavior === 'deny'; const mediumRisk = result.behavior === 'ask';
  return { riskLevel: highRisk ? 'HIGH' : mediumRisk ? 'MEDIUM' : 'LOW', explanation: result.reason, reasoning: `The configured enterprise rule resolves this operation as ${result.behavior}.`, risk: highRisk ? 'Operation is blocked by policy.' : mediumRisk ? 'Human confirmation is required.' : 'Operation matches an explicit allow rule.' };
}
