import { resolve } from 'node:path';
import { loadPlatform } from '../platform.js';
import { loadAgent, spawnAgent, waitForAgent } from '../agent.js';
import type { AgentRecord } from '../types.js';
import type { AgentSdkEvent, AgentSdkOptions } from './agentSdkTypes.js';
import type { RuntimeEvent } from '../runtimeEvents.js';
import { AsyncQueue } from '../utils/async.js';

export async function runAgent(options: AgentSdkOptions): Promise<AgentRecord> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const platform = await loadPlatform(cwd);
  if (options.permissionMode) platform.config.policy.mode = options.permissionMode;
  return spawnAgent({
    goal: options.prompt,
    cwd,
    config: platform.config,
    role: options.agent ?? 'lead',
    isolation: options.isolation ?? 'none',
    background: options.background ?? false,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.skills ? { skills: options.skills } : {}),
    ...(options.systemPrompt ? { instructions: options.systemPrompt } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
  });
}

export async function* query(options: AgentSdkOptions): AsyncGenerator<AgentSdkEvent, AgentRecord> {
  if (options.background === true) {
    const agent = await runAgent({ ...options, background: true });
    yield { type: 'started', agent };
    const finished = agent.status === 'queued' || agent.status === 'working' ? await waitForAgent(agent.id) : agent;
    if (finished.status === 'waiting_for_input') yield { type: 'waiting_for_input', agent: finished };
    else if (finished.status === 'completed') yield { type: 'completed', agent: finished };
    else yield { type: 'failed', agent: finished };
    return finished;
  }

  const events = new AsyncQueue<RuntimeEvent>();
  const execution = runAgent({
    ...options,
    background: false,
    onEvent: (event) => {
      options.onEvent?.(event);
      events.push(event);
    },
  }).finally(() => events.close());
  let started = false;
  for await (const event of events) {
    if (!started && event.type === 'agent_status' && event.status === 'queued') {
      started = true;
      yield { type: 'started', agent: await loadAgent(event.agentId) };
    }
    yield { type: 'runtime', event };
  }
  const finished = await execution;
  if (finished.status === 'waiting_for_input') yield { type: 'waiting_for_input', agent: finished };
  else if (finished.status === 'completed') yield { type: 'completed', agent: finished };
  else yield { type: 'failed', agent: finished };
  return finished;
}

export type { AgentSdkEvent, AgentSdkOptions } from './agentSdkTypes.js';
export type { PlatformConfig, McpServerConfig, AgentRecord, ModelMessage, ToolDefinition, HookDefinition } from '../types.js';
export { watchMcpServer } from '../mcp.js';
export { requestMcpServer, callMcpServer } from '../mcp.js';
export type { McpInteractionHandlers, McpSamplingRequest, McpSamplingResult, McpElicitationRequest, McpElicitationResult,McpUrlElicitation,McpMultimodalSamplingRequest,McpMultimodalSamplingResult } from '../mcpInteraction.js';
export type {McpModernSamplingRequest,McpModernSamplingResult,McpSamplingBlock,McpSamplingToolUse,McpSamplingToolResult} from '../mcpSamplingModern.js';
export {McpProtocolError} from '../mcpErrors.js';
export {stageMarketplacePluginSet} from '../marketplace.js';
export { discoverMcpOAuth, loginMcpAuthorizationCode } from '../mcpOAuth.js';
export type { McpOAuthDeployment, OAuthLoginDetails, OAuthLoginOptions } from '../mcpOAuth.js';
export { loadConfig as loadSettings } from '../config.js';
export type { McpWatchOptions, McpWatchResult, McpNotification } from '../mcpNotifications.js';
export * as analytics from '../services/analytics/index.js';
export * as analyticsMetadata from '../services/analytics/metadata.js';
export * as featureGates from '../services/analytics/growthbook.js';
export * as api from '../services/api/client.js';
export * as apiErrors from '../services/api/errors.js';
export * as oauth from '../services/oauth/index.js';
export * as mcpServices from '../services/mcp/utils.js';
export * as magicDocs from '../services/MagicDocs/magicDocs.js';
export * as autoDream from '../services/autoDream/autoDream.js';
export * as lspServices from '../services/lsp/LSPServerManager.js';
export * as pluginOperations from '../services/plugins/pluginOperations.js';
export * as toolUseSummary from '../services/toolUseSummary/toolUseSummaryGenerator.js';
export * as mcpApproval from '../services/mcpServerApproval.js';
export * as voice from '../services/voice.js';
export * as voiceStream from '../services/voiceStreamSTT.js';
export * as commands from '../commands/index.js';
export * as components from '../components/index.js';
export * as terminal from '../ink/index.js';
export * as hooks from '../hooks/index.js';
export * as utilities from '../utils/index.js';
export * as screens from '../screens/index.js';
export * as voiceMode from '../voice/index.js';
export * as cli from './cli.js';
export * as sandbox from './sandboxTypes.js';
export * as artifacts from '../artifacts.js';
export * as channels from '../channels.js';
export * as automation from '../automation.js';
export * as usage from '../usage.js';
export * as enterprise from '../enterprise.js';
export * as surfaces from '../integrations/surfaces.js';
export * as permissionApprovals from '../permissionApprovals.js';
export * as enhancements from '../enhancements/index.js';
export * from './sdk/session.js';
export * from '../runtimeEvents.js';
export * from '../plans.js';
export * from '../planExecution.js';
export { listPluginHistory, snapshotPlugin, rollbackPlugin, installTrustedPlugin } from '../pluginHistory.js';
export type { PluginRevision, PluginScope } from '../pluginHistory.js';
export { invokeUserSkill } from '../skillInvocation.js';
export { expandSkillInstructions, modelInvocableSkill, userInvocableSkill, skillCatalog } from '../skills.js';
export * as teams from '../teamStore.js';
export * as teamMailbox from '../mailbox.js';
export * as taskStore from '../tasks.js';
export * as agentMemory from '../agentMemory.js';
export { continueAgent, loadAgent, cancelAgent, waitForAgent } from '../agent.js';
export { loadSession } from '../sessions.js';
export type { ResponsesRequest, ResponsesResponse, ResponsesItem } from '../responsesProtocol.js';
export { callModel } from '../model.js';
export { responsesRequest } from '../responsesModel.js';
export { listInterruptedPluginTransactions, recoverPluginTransaction } from '../pluginHistory.js';
export { listModelCredentials, storeModelCredential, removeModelCredential } from '../protectedModelCredentials.js';
export { diagnosticBundle, exportDiagnosticBundle } from '../diagnosticBundle.js';
export { inspectGitConflicts, listWorktreeRecoveries, restoreWorktreeRecovery } from '../worktree.js';
export { inspectMarketplaceInstallations, repairMarketplaceReceipt } from '../marketplace.js';
export type { MarketplaceInstallationStatus } from '../marketplace.js';
export { hookCompatibilityMatrix, HOOK_EVENTS } from '../hookContracts.js';
export { watchLocalState, projectStateWatchPaths } from '../localStateWatch.js';
export { recoveryPage, pruneWorktreeRecovery, conflictGuide, conflictVersions, stageResolvedConflict } from '../worktree.js';
export {reviewBinaryConflict,stageReviewedBinaryConflict} from '../worktree.js';
export {signPluginOverlay} from '../pluginOverlays.js';
export {verifyIntegrityAudit} from '../auditIntegrity.js';
export {countTextTokens,countPinnedTextTokens} from '../textTokenizer.js';
export {withModelToolChoice} from '../modelToolChoice.js';
export type {ModelToolChoice} from '../modelToolChoice.js';
export {readSpending,withSpendScope} from '../spending.js';
export {measureContext,contextPressure,conversationBudget} from '../contextBudget.js';
export {displayAssistantMessage} from '../messageDisplay.js';
export {runtimeReplay,flushRuntimeReplay} from '../runtimeReplay.js';
export type {RuntimeReplayPolicy} from '../runtimeReplay.js';
export {bindLauncher} from '../launcherBinding.js';
export {previewPluginRollout,preparePluginRollout,applyPluginRollout,reconcilePluginRollout,inspectPluginRollouts,checkPluginRollouts} from '../pluginRollout.js';
export type {PluginRolloutPolicy} from '../pluginRollout.js';
export {runEnterpriseAcceptance} from '../enterpriseAcceptance.js';
export type {EnterpriseAcceptanceOptions} from '../enterpriseAcceptance.js';
export {benchmarkTextContext} from '../contextBenchmark.js';
export {stagePluginSet,activatePluginSet,inspectPluginSet} from '../pluginSets.js';
export {goalCandidates,listGoalWorkflows,decideGoalWorkflow} from '../goalManagement.js';
export {reviewGoalWorkflow} from '../goalManagement.js';
export {prepareScheduledGoal,prepareScheduledBackup,inspectScheduledWorkflows,reconcileScheduledBackup} from '../scheduledWorkflows.js';
export {reviewConflictResolution,resolveConflict} from '../conflictResolution.js';
export type {ConflictChoice} from '../conflictResolution.js';
export { previewConflictRestore, restoreConflictResolution } from '../conflictRestore.js';
export type {GoalPreparation,GoalCandidate,GoalDecision} from '../goalManagement.js';
export {planRecoveryMaintenance,runRecoveryMaintenance,prepareRecoveryRemote,runRecoveryRemote,queryRecoveryRemote} from '../recoveryMaintenance.js';
export { repairAutomationState, validateAutomationState } from '../automationRecovery.js';
export { createRecoveryBackup, inspectRecoveryBackup, importRecoveryBackup } from '../recoveryBackup.js';
export { listPluginOrphans, quarantinePluginOrphan } from '../pluginOrphans.js';
export { prepareAutomationScheduler, schedulerTaskXml, installAutomationScheduler, tickAutomationScheduler, disableAutomationScheduler } from '../automationScheduler.js';
export { projectEventsAfter, publishProjectInvalidation } from '../projectEvents.js';
export { recoverProjectOutboxes } from '../projectOutbox.js';
export { acceptAuditCheckpoint, readCollectorCheckpoint, verifyAuditCheckpoint, syncAuditCheckpoint } from '../auditCheckpoint.js';
export type { AuditCollectorConfig, AuditCheckpointRequest, AuditCheckpointReceipt } from '../auditCheckpoint.js';
export { previewPluginSetActivation, activateReviewedPluginSet, inventoryPluginSets, recoverInterruptedPluginSet } from '../pluginSets.js';
export { previewLegacyPluginMigration, migrateLegacyPlugins } from '../pluginSets.js';
export type { LegacyPluginSelection } from '../pluginSets.js';
export { listGlobalExtensionTrust, setGlobalExtensionTrust } from '../globalExtensionTrust.js';
export { listProjectNotifications, createProjectNotification, markProjectNotificationsRead } from '../notifications.js';
export type { ProjectNotification } from '../notifications.js';
export { listAutomationSchedulers, inspectAutomationScheduler, rebindAutomationScheduler, uninstallAutomationScheduler, assertOwnedSchedulerTask } from '../schedulerManagement.js';
export {previewSchedulerMigration,migrateLegacyScheduler} from '../schedulerMigration.js';
export { prepareReadOnlyAutomation, inspectReadOnlyRuns } from '../scheduledAgent.js';
export { nativeSchedulerDefinitions } from '../nativeSchedulers.js';
export { sessionHistory } from '../sessionHistoryView.js';
export { runtimeHistory, flushRuntimeHistory } from '../runtimeHistory.js';
export { scheduleWakeup, bindWakeupToJob, listWakeups, setSessionGoal, listSessionGoals, transitionSessionGoal } from '../automation.js';
export { prepareGoalWorkflow, inspectGoalWorkflow, runGoalWorkflow, launchGoalWorkflow, resumeGoalWorkflow, recoverGoalWorkflow, cancelGoalWorkflow } from '../goalWorkflow.js';
export { listOperations, inspectOperation, queryOperation, resolveOperation, compensateOperation, registerOperationConnector } from '../operationRecovery.js';
export type { OperationRecord, OperationConnector } from '../operationRecovery.js';
export { recoverAutomationScheduler } from '../schedulerManagement.js';
export { startHookFileWatch } from '../hookFileWatch.js';
export type {HookFileWatcher,HookWatchStatus} from '../hookFileWatch.js';
export { createMcpModelSampling, validateMcpSamplingBudget } from '../mcpModelSampling.js';
export type { McpSamplingBudget } from '../mcpModelSampling.js';
export {acceptMcpDeployment} from '../mcp.js';
export {countProviderInput} from '../inputTokenCounting.js';
export {evaluateCompactionQuality} from '../compactionQuality.js';
export type {CompactionQualityPolicy} from '../compactionQuality.js';
export {previewPluginSetRemediation,remediatePluginSet,pluginSetHealth} from '../pluginSets.js';
export {runContextQualityEval} from '../contextQualityEval.js';
export type {ContextQualityCase} from '../contextQualityEval.js';
export {createAuditCollectorServer} from '../auditCollectorServer.js';
export type {AuditCollectorServerConfig} from '../auditCollectorServer.js';
export {signPlugin,verifyPluginSignature} from '../pluginSignatures.js';
