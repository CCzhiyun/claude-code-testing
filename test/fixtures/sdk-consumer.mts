import { callMcpServer, loadSettings, query, cli, sessionHistory, runtimeHistory, transitionSessionGoal, bindWakeupToJob, prepareGoalWorkflow, inspectGoalWorkflow, registerOperationConnector, goalCandidates, decideGoalWorkflow, planRecoveryMaintenance, prepareScheduledGoal, prepareScheduledBackup, resolveConflict, stageMarketplacePluginSet, McpProtocolError, type McpModernSamplingRequest, type ConflictChoice, type GoalDecision, type OperationRecord, type McpInteractionHandlers, type PlatformConfig, type AgentSdkOptions } from 'ccpt/sdk';

const handlers: McpInteractionHandlers = {
  confirmSampling: async (request, signal) => request.maxTokens > 0 && !signal.aborted,
  sample: async () => ({ role: 'assistant', content: { type: 'text', text: 'typed response' }, model: 'company-model' }),
  confirmSamplingResult: async (result, request, signal) => result.role === 'assistant' && request.maxTokens > 0 && !signal.aborted,
  elicit: async () => ({ action: 'decline' }),
};
async function example(config: PlatformConfig) {
  const server = { transport: 'http' as const, httpMode: 'streamable' as const, url: 'https://example.invalid/mcp' };
  const response: unknown = await callMcpServer('company', server, 'review', {}, true, undefined, config, handlers);
  const options: AgentSdkOptions = { prompt: 'Review a bounded project', permissionMode: 'restricted' };
  for await (const event of query(options)) if (event.type === 'completed') console.log(event.agent.status);
  const loaded: PlatformConfig = await loadSettings('.');
  const version: string = cli.CLI_VERSION;
  return { response, loaded, version };
}
// These directives fail compilation if the published SDK silently degrades to any.
// @ts-expect-error maxTokens is numeric, not a string.
const invalidRequest: Parameters<NonNullable<McpInteractionHandlers['sample']>>[0] = { messages: [], maxTokens: 'wrong' };
// @ts-expect-error permission modes are constrained.
const invalidOptions: AgentSdkOptions = { prompt: 'x', permissionMode: 'uncontrolled' };
void example; void invalidRequest; void invalidOptions;
async function inspectHistory() {
  const history = await sessionHistory('.', 'session_1111111111111111', { includeText: true, limit: 20 });
  const text: string | undefined = history.items[0]?.text;
  const metadata = await runtimeHistory('.', history.sessionId, undefined, 100);
  const sequence: number | undefined = metadata.items[0]?.sequence;
  const goal = await transitionSessionGoal('goal_1111111111111111', 'paused', 1, '.', 'Reviewed pause');
  await bindWakeupToJob('wakeup_1111111111111111', 'scheduler_1111111111111111', '.');
  return { text, sequence, goal };
}
// @ts-expect-error viewing text requires an explicit boolean, not an arbitrary string.
void sessionHistory('.', 'session_1111111111111111', { includeText: 'yes' });
// @ts-expect-error Goal transitions use the declared closed state set.
void transitionSessionGoal('goal_1111111111111111', 'approved', 1, '.');
void inspectHistory;
async function workflowTypes(config:PlatformConfig){
 config.runtimeHistory={mode:'redacted',maxTextChars:16000};
 const run=await prepareGoalWorkflow('.',{goalId:'goal_1111111111111111',planId:'plan_1111111111111111',expectedPlanVersion:1,maxRequests:3,maxTokens:100000,allowedTools:['read_file']});
 const record=await inspectGoalWorkflow('.',run.id);const requests:number=record.requests;
 const remove=registerOperationConnector('fixture',{inspect:async(operation:Readonly<OperationRecord>)=>({phase:operation.phase})});remove();return requests;
}
// @ts-expect-error workflow requests must be a number.
void prepareGoalWorkflow('.',{goalId:'x',planId:'y',expectedPlanVersion:1,maxRequests:'unbounded',maxTokens:100000,allowedTools:[]});
void workflowTypes;
async function latestTypes(config:PlatformConfig){
 const candidates=await goalCandidates('.');const plan=await planRecoveryMaintenance('.',config);const decision:GoalDecision={action:'cancel',id:'goalrun_1111111111111111',expectedVersion:1,confirm:true};await decideGoalWorkflow('.',decision,'/owned/cli.js');
 const media:McpInteractionHandlers={urlOrigins:['https://approved.example'],elicitUrl:async()=>({action:'decline'}),confirmMultimodalSampling:async()=>false,sampleMultimodal:async()=>({role:'assistant',model:'fixture',content:{type:'audio',data:'Zml4dHVyZQ==',mimeType:'audio/wav'}}),confirmMultimodalSamplingResult:async()=>false};return {candidates,plan,media};
}
// @ts-expect-error unbounded implicit workflow approval is not an action.
const invalidGoal:GoalDecision={action:'auto',id:'x',expectedVersion:1,confirm:true};
void latestTypes;void invalidGoal;
async function scheduledTypes(config:PlatformConfig){await prepareScheduledGoal('.','/owned/cli.js','goalrun_1111111111111111',1,true,5);await prepareScheduledBackup('.','/owned/cli.js',3,true,60);const choice:ConflictChoice='theirs';await resolveConflict('.','binary.dat',choice,'a'.repeat(64),true,config);}
// @ts-expect-error side selection has no implicit auto choice.
const invalidConflict:ConflictChoice='auto';
void scheduledTypes;void invalidConflict;
const modern:McpInteractionHandlers={samplingTools:true,confirmModernSampling:async(request,signal)=>!!request.tools?.length&&!signal.aborted,sampleModern:async()=>({role:'assistant',model:'fixture',stopReason:'toolUse',content:[{type:'tool_use',id:'one',name:'lookup',input:{q:'fixture'}}]}),confirmModernSamplingResult:async()=>false,onUrlElicitationComplete:id=>{const text:string=id;void text;}};
// @ts-expect-error tool choices are constrained by the published modern protocol type.
const invalidSampling:McpModernSamplingRequest={messages:[],maxTokens:20,toolChoice:{mode:'uncontrolled'}};
async function modernTypes(){const staged=await stageMarketplacePluginSet('.',['plugin@catalog'],true);const id:string=staged.id;const error=new McpProtocolError({code:-32042,message:'Review',data:{elicitations:[{mode:'url',url:'https://approved.example/review',elicitationId:'one',message:'Review'}]}},{urlOrigins:['https://approved.example']});const code:number=error.code;return {id,code,requests:error.elicitations};}
void modern;void invalidSampling;void modernTypes;
async function committedTypes(){
 const sdk=await import('ccpt/sdk');const delivery=await sdk.recoverProjectOutboxes('.');const ok:boolean|undefined=delivery[0]?.ok;
 const preview=await sdk.previewPluginSetActivation('.','pluginset_1111111111111111');await sdk.activateReviewedPluginSet('.',preview.candidate,preview.reviewDigest,true);
 const collector:import('ccpt/sdk').AuditCollectorConfig={url:'https://collector.example/audit',stream:'team',keyId:'collector',publicKey:'PEM',tokenEnv:'AUDIT_TOKEN'};
 const receipt=await sdk.syncAuditCheckpoint('.',collector,'2026-10-19','query',true);const rows:number|undefined=receipt.receipt?.rows;return {ok,rows};
}
// @ts-expect-error network operations have a closed mode, never implicit replay.
const invalidCheckpointMode:Parameters<typeof import('ccpt/sdk').syncAuditCheckpoint>[3]='retry-forever';
void invalidCheckpointMode;
void committedTypes;
async function migrationAndWatchTypes(config:PlatformConfig){const sdk=await import('ccpt/sdk');const review=await sdk.previewSchedulerMigration('scheduler_1111111111111111','/owned/cli.js');await sdk.migrateLegacyScheduler(review.id,'/owned/cli.js',review.expectedDigest,true);const watch:import('ccpt/sdk').HookFileWatcher=sdk.startHookFileWatch(config,'.');const status:import('ccpt/sdk').HookWatchStatus=watch.status();watch();return status.files;}
// @ts-expect-error recursive directory configuration cannot take an implicit arbitrary string.
const badWatch:NonNullable<PlatformConfig['hooks'][number]['watchDirectories']>[number]={path:'src',recursive:'yes'};
void migrationAndWatchTypes;void badWatch;
async function capabilities067(config:PlatformConfig){const sdk=await import('ccpt/sdk');const selection:import('ccpt/sdk').LegacyPluginSelection[]=[{name:'team',scope:'project'}];const review=await sdk.previewLegacyPluginMigration('.',selection);await sdk.migrateLegacyPlugins('.',selection,review.reviewDigest,true);const undo=await sdk.previewConflictRestore('.','conflict_1111111111111111',config);await sdk.restoreConflictResolution('.',undo.id,undo.reviewDigest,true,config);const sampling=sdk.createMcpModelSampling(config,{maxRequests:1,maxReservedTokens:100000,tools:true},async()=>false,{tools:true});return sampling.status();}
// @ts-expect-error sampling is budgeted, not a bypass-permission toggle.
const badSamplingBudget:import('ccpt/sdk').McpSamplingBudget={maxRequests:1,maxReservedTokens:10,tools:'always'};
void capabilities067;void badSamplingBudget;
function capabilities068(config:PlatformConfig){const sdk=import('ccpt/sdk');config.spending={account:'team',maxRequests:5};config.messageDisplay={mode:'lines',linesPerBatch:2,maxBatches:64};config.model.tokenizerVocabulary={file:'/owned/vocab.json',sha256:'0'.repeat(64),patternEncoding:'cl100k_base'};config.model.contextFraming={baseTokens:10,perMessageTokens:3,perToolTokens:8};config.recoveryRemote={remote:'backup',expectedUrl:'ssh://git@backup.example/repo',transport:'ssh-wrapper'};return sdk.then(s=>s.withModelToolChoice('required',()=>s.readSpending('account:team')));}
// @ts-expect-error unsupported tool-choice must not leak into the wire contract.
const invalidChoice:import('ccpt/sdk').ModelToolChoice='force-any';
// @ts-expect-error framing settings are numeric reserves, not an arbitrary code string.
const invalidFraming:NonNullable<PlatformConfig['model']['contextFraming']>={baseTokens:1,perMessageTokens:'script',perToolTokens:1};
void capabilities068;void invalidChoice;void invalidFraming;
async function capabilities069(config:PlatformConfig){const sdk=await import('ccpt/sdk');config.runtimeReplay={mode:'verbatim',acknowledgement:'I_ACCEPT_LOCAL_PLAINTEXT_TRANSCRIPTS'};config.pluginRollout={allowedVersions:{team:['1.0.0']}};config.model.audioInputFormats=['wav'];config.model.tokenizerVocabulary={file:'/owned/vocab.json',sha256:'0'.repeat(64),patternEncoding:'custom',specialTokenMode:'allowed',timeoutMs:1000};const p=await sdk.runtimeReplay('.','session_1111111111111111',undefined,100,true);const passive:false=p.executesActions;const binding=await sdk.bindLauncher('/owned/launcher',['/owned/config']);const review=await sdk.previewPluginRollout('.','pluginset_1111111111111111');return {passive,binding,review};}
// @ts-expect-error plaintext capture cannot be enabled without explicit acknowledgement.
const unacknowledgedReplay:import('ccpt/sdk').RuntimeReplayPolicy={mode:'verbatim'};
// @ts-expect-error sampling audio consent is a capability boolean, not a model setting string.
const badAudio:import('ccpt/sdk').McpSamplingBudget={maxRequests:1,maxReservedTokens:1000,audio:'always'};
void capabilities069;void unacknowledgedReplay;void badAudio;
async function capabilities070(config:PlatformConfig){const sdk=await import('ccpt/sdk');config.model.inputTokenCounting={mode:'responses',onError:'stop',timeoutMs:1000};config.contextCompaction={mode:'semantic',quality:{requiredTerms:['src/api.ts'],minimumCoverage:1}};const report=sdk.evaluateCompactionQuality('src/api.ts','src/api.ts',{requiredTerms:['src/api.ts']});const notProof:false=report.semanticEquivalenceVerified;const counted=await sdk.countProviderInput(config,'',[],[]);const health=await sdk.pluginSetHealth('.');return {notProof,counted,health,collector:sdk.createAuditCollectorServer,accept:sdk.acceptMcpDeployment,repair:sdk.remediatePluginSet,evaluate:sdk.runContextQualityEval};}
// @ts-expect-error native count protocol cannot silently use a Chat request shape.
const badCounter:NonNullable<PlatformConfig['model']['inputTokenCounting']>={mode:'chat-completions'};
// @ts-expect-error administrator storage ownership acknowledgement is mandatory.
const badCollector:import('ccpt/sdk').AuditCollectorServerConfig={storageDirectory:'/state',signingKeyFile:'/key',keyId:'key',streams:{team:{tokenEnv:'TOKEN'}},allowLoopbackHttp:true};
void capabilities070;void badCounter;void badCollector;
