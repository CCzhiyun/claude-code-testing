import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { applyManagedConfiguration } from './config.js';
import type { PlatformConfig } from './types.js';
export interface ReadOnlyAutomationLimits { maxRequests:number; maxTokens:number; maxRuns:number; deploymentDigest:string }
export const AUTOMATION_READ_TOOLS = ['read_file','list_files','search_text'] as const;
export function automationDeploymentDigest(config:PlatformConfig):string {
  const model=config.model;
  return createHash('sha256').update(JSON.stringify([model.provider,model.apiProtocol,model.responsesTransport,model.name,model.baseUrl,model.endpointUrl,model.apiKeyEnv,model.credentialRef,...(model.credentialBackend?[model.credentialBackend]:[])])).digest('hex');
}
export function validateReadOnlyLimits(value:ReadOnlyAutomationLimits):void {
  if(!value || !Number.isSafeInteger(value.maxRequests)||value.maxRequests<1||value.maxRequests>100||!Number.isSafeInteger(value.maxTokens)||value.maxTokens<1024||value.maxTokens>10_000_000||!Number.isSafeInteger(value.maxRuns)||value.maxRuns<1||value.maxRuns>20||!/^[a-f0-9]{64}$/.test(value.deploymentDigest)) throw new Error('Read-only automation requires bounded requests (1–100), tokens (1024–10000000), runs (1–20) and a bound deployment');
}
/** A tool-capability ceiling, NOT an OS sandbox. Managed requirements win by
 * refusing execution if they conflict, never by silently dropping enterprise Hooks. */
export function readOnlyAutomationConfig(input:PlatformConfig,cwd:string,limits:ReadOnlyAutomationLimits):PlatformConfig {
  validateReadOnlyLimits(limits);
  if(automationDeploymentDigest(input)!==limits.deploymentDigest)throw new Error('Scheduled deployment changed; prepare and review a new job');
  const config=structuredClone(input);
  config.policy={...config.policy,mode:'restricted',workspaceRoots:[resolve(cwd)],allowNetwork:false,allowGitPush:false,allowPullRequests:false,allowedCommands:[]};
  config.toolFilter=[...AUTOMATION_READ_TOOLS];config.hooks=[];config.mcpServers={};config.lspServers={};config.skillsDirectories=[];config.agentsDirectories=[];config.pluginDirectories=[];config.agentDefinitions={};config.marketplaceEnabled=false;config.disableBundledSkills=true;config.coordinatorMode=false;
  config.model.maxContextTokens=Math.min(config.model.maxContextTokens,32000);config.model.maxOutputTokens=Math.min(config.model.maxOutputTokens,4096);config.model.responsesStore=false;
  config.agents={...config.agents,maxTurns:Math.min(3,config.agents.maxTurns),defaultIsolation:'none',maxDepth:0};config.network.timeoutMs=Math.min(config.network.timeoutMs,20000);
  config.modelRetry={...config.modelRetry,maxRetries:0,maxWaitMs:1000};
  config.spending={...config.spending,maxRequests:Math.min(config.spending?.maxRequests ?? limits.maxRequests,limits.maxRequests),maxTokens:Math.min(config.spending?.maxTokens ?? limits.maxTokens,limits.maxTokens)};
  const managed=applyManagedConfiguration(config);
  if(managed.policy.mode!=='restricted'||managed.hooks.length||Object.keys(managed.mcpServers).length||managed.skillsDirectories.length||managed.agentsDirectories.length||managed.pluginDirectories.length||Object.keys(managed.agentDefinitions ?? {}).length||managed.marketplaceEnabled!==false||managed.disableBundledSkills!==true||managed.coordinatorMode||managed.policy.allowNetwork||managed.policy.allowGitPush||managed.policy.allowPullRequests||!managed.toolFilter||managed.toolFilter.some(name=>!(AUTOMATION_READ_TOOLS as readonly string[]).includes(name))||automationDeploymentDigest(managed)!==limits.deploymentDigest)throw new Error('Managed policy conflicts with the read-only scheduled capability ceiling; execution refused');
  if(managed.policy.workspaceRoots.length!==1 || resolve(managed.policy.workspaceRoots[0]!)!==resolve(cwd) || managed.agents.maxTurns>3 || managed.agents.maxDepth!==0 || managed.model.maxContextTokens>32000 || managed.model.maxOutputTokens>4096 || managed.modelRetry?.maxRetries!==0 || !managed.spending?.maxRequests || managed.spending.maxRequests>limits.maxRequests || !managed.spending.maxTokens || managed.spending.maxTokens>limits.maxTokens)throw new Error('Managed policy exceeds scheduled execution/budget bounds; execution refused');
  return managed;
}
