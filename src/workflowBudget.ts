import { createHash } from 'node:crypto';
import type { PlatformConfig } from './types.js';
import { automationDeploymentDigest } from './readOnlyAutomation.js';
export interface WorkflowBudget { runId:string; maxRequests:number; maxTokens:number; allowedTools:string[]; deploymentDigest:string; policyDigest:string }
export const workflowPolicyDigest=(config:PlatformConfig)=>createHash('sha256').update(JSON.stringify(config.policy)).digest('hex');
export function applyWorkflowBudget(config:PlatformConfig,value:WorkflowBudget):PlatformConfig {
  if(!/^goalrun_[a-f0-9]{16}$/.test(value.runId)||!Number.isSafeInteger(value.maxRequests)||value.maxRequests<1||value.maxRequests>1000||!Number.isSafeInteger(value.maxTokens)||value.maxTokens<1024||value.maxTokens>100_000_000||!Array.isArray(value.allowedTools)||!value.allowedTools.length||value.allowedTools.length>256||value.allowedTools.some(name=>typeof name!=='string'||!/^[\w:.-]{1,120}$/.test(name)))throw new Error('Invalid Goal workflow capability/budget bounds');
  if(automationDeploymentDigest(config)!==value.deploymentDigest||workflowPolicyDigest(config)!==value.policyDigest)throw new Error('Goal workflow model/policy changed; review a new workflow rather than widening the saved authorization');
  if(config.ephemeralSession||config.policy.mode==='bypass')throw new Error('Persistent Goal workflows cannot use ephemeral or bypass mode');
  const result=structuredClone(config);
  result.toolFilter=value.allowedTools.filter(name=>!config.toolFilter||config.toolFilter.includes(name));
  result.spending={...config.spending,maxRequests:Math.min(config.spending?.maxRequests??value.maxRequests,value.maxRequests),maxTokens:Math.min(config.spending?.maxTokens??value.maxTokens,value.maxTokens)};
  return result;
}
