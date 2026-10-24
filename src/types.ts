export type AgentStatus = 'queued' | 'working' | 'waiting_for_input' | 'completed' | 'failed' | 'cancelled';
export type TaskStatus = 'queued' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type PermissionMode = 'normal' | 'acceptEdits' | 'sandbox' | 'restricted' | 'bypass';
export type HookEvent =
  | 'SessionStart'
  | 'SessionEnd'
  | 'UserPromptSubmit'
  | 'UserPromptExpansion'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'PostToolBatch'
  | 'PermissionRequest'
  | 'PermissionDenied'
  | 'Notification'
  | 'MessageDisplay'
  | 'TaskCompleted'
  | 'TeammateIdle'
  | 'WorktreeCreate'
  | 'WorktreeRemove'
  | 'ConfigChange'
  | 'Setup'
  | 'Stop'
  | 'StopFailure'
  | 'InstructionsLoaded'
  | 'CwdChanged'
  | 'DirectoryAdded'
  | 'FileChanged'
  | 'PreCompact'
  | 'PostCompact'
  | 'PreModelSwitch'
  | 'PostModelSwitch'
  | 'Elicitation'
  | 'ElicitationResult'
  | 'TaskCreated'
  | 'TaskUpdated'
  | 'SubagentStart'
  | 'SubagentStop'
  | 'CheckpointCreated'
  | 'CheckpointRestored';

export interface AgentRecord {
  workflowBudget?: import('./workflowBudget.js').WorkflowBudget;
  readOnlyAutomation?: import('./readOnlyAutomation.js').ReadOnlyAutomationLimits;
  id: string;
  parentId?: string;
  sessionId: string;
  /** Root conversation shared for limits and team discovery. Each Agent still owns a distinct sessionId. */
  teamSessionId?: string;
  taskId?: string;
  /** Durable project Plan this Agent is executing after approval. */
  planId?: string;
  /** Whether this Agent turn is restricted to research and Plan submission. */
  planMode?: boolean;
  pendingPlanId?: string;
  contextMode?: 'isolated' | 'fork';
  goal: string;
  role: string;
  skills?: string[];
  /** Explicit inline Skill activation, cleared on the next human turn. */
  turnSkills?: string[];
  skillArguments?: string;
  turnToolCeiling?: string[];
  instructions?: string;
  /** Capability ceiling retained across continuation; never expanded by model output. */
  allowedTools?: string[];
  deniedTools?: string[];
  profileName?: string;
  /** Question tool result to replace with the user's answer on continuation. */
  pendingQuestionToolId?: string;
  cwd: string;
  worktree?: string;
  runtimeCwd?:string;
  depth: number;
  status: AgentStatus;
  pid?: number;
  createdAt: string;
  updatedAt: string;
  result?: string;
  /** Surface-only text; never copied back into the canonical conversation. */
  displayResult?:string;
  error?: string;
  heartbeatAt?: string;
  /** Latest provider and tool activity snapshot for native TUI polling across worker processes. */
  stream?: AgentStreamState;
}

export interface AgentStreamState {
  retry?: import('./modelRetry.js').RetryNotice & { at: string };
  contextPressure?: import('./contextBudget.js').ContextPressureNotice;
  contextRecovery?: import('./contextRecovery.js').ContextRecoveryNotice;
  turn: number;
  text: string;
  thinking?: string;
  phase: 'thinking' | 'responding' | 'tool' | 'working';
  startedAt: string;
  updatedAt: string;
  activeTool?: { name: string; input?: Record<string, unknown> };
  inputTokens?: number;
  outputTokens?: number;
  inputTokenSource?: 'reported' | 'estimated';
  outputTokenSource?: 'reported' | 'estimated';
  toolCalls?: number;
}

export interface TaskRecord {
  id: string;
  teamSessionId: string;
  sessionId?: string;
  parentTaskId?: string;
  agentId?: string;
  ownerAgentId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
  result?: string;
  error?: string;
}

export interface TeamMessage {
  id: string;
  teamSessionId: string;
  fromAgentId: string;
  toAgentId: string;
  kind: 'message' | 'task_assignment' | 'permission_request' | 'permission_response' | 'shutdown_request' | 'status';
  content: string;
  createdAt: string;
  read: boolean;
}

export interface CheckpointEntry {
  path: string;
  existed: boolean;
  contentBase64?: string;
  backupFileName?: string;
  version?: number;
  backupTime?: string;
  mode?: number;
}

export interface CheckpointRecord {
  id: string;
  workspace: string;
  sessionId?: string;
  agentId?: string;
  reason: string;
  createdAt: string;
  sessionMessageCount?: number;
  conversationBackupFileName?: string;
  entries: CheckpointEntry[];
}

export interface SessionRecord {
  git?: import('./sessionGit.js').SessionGitIdentity;
  /** Portable preferences/capability ceilings only; never credentials, routes or bypass permissions. */
  resume?: { version: 1; role: string; modelName?: string; effort?: PlatformConfig['model']['reasoningEffort']; thinkingEnabled?: boolean; planMode?: boolean; allowedTools?: string[]; deniedTools?: string[]; profileName?: string };
  contextWarningBand?: number;
  contextPressure?: import('./contextBudget.js').ContextPressureNotice;
  contextRecovery?: import('./contextRecovery.js').ContextRecoveryNotice & { at: string };
  contextSnapshot?: import('./contextBudget.js').ContextSnapshot;
  id: string;
  parentId?: string;
  title: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messages: ModelMessage[];
  archivedMessages?: ModelMessage[];
  summary?: string;
  compaction?: import('./semanticCompaction.js').CompactionRecord;
}

export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
  responses?: { scope: string; id: string; prefixHash: string; output: Record<string, unknown>[]; stored: boolean };
}

export interface ContentBlock {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image' | 'audio';
  text?: string;
  signature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
  media_type?: string;
  data?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface HookBase {
  /** Informational provenance, never a permission grant. */
  source?: string;
  event: HookEvent;
  matcher?: string;
  /** Explicit FileChanged observer filenames. Never follows links. */
  watchPaths?: string[];
  /** Opt-in bounded directory observation, not authorization to execute a Hook. */
  watchDirectories?: Array<{path:string;recursive?:boolean;maxFiles?:number;maxDepth?:number;exclude?:string[]}>;
  if?: string;
  command: string;
  timeoutMs?: number;
  timeout?: number;
  statusMessage?: string;
  once?: boolean;
}

export interface HookCommand extends HookBase {
  type?: 'command';
  async?: boolean;
}

export interface HookHttp extends Omit<HookBase, 'command'> {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  allowedEnvVars?: string[];
}

export interface HookPrompt extends Omit<HookBase, 'command'> {
  type: 'prompt';
  prompt: string;
  model?: string;
}

export interface HookAgent extends Omit<HookBase, 'command'> {
  type: 'agent';
  prompt: string;
  model?: string;
}

export type HookDefinition = HookCommand | HookHttp | HookPrompt | HookAgent;

export interface McpServerConfig {
  /** Cost-capability ceiling; never grants request/share approval. */
  samplingBudget?: import('./mcpModelSampling.js').McpSamplingBudget;
  /** Explicit administrator-declared operation protocol; never inferred. */
  operationRecovery?:Record<string,{idempotencyArgument:string;statusTool:string;compensateTool?:string;operationArgument?:string;businessScope?:string;businessKeyFields?:string[]}>;
  transport: 'stdio' | 'http';
  /** direct preserves legacy stateless gateways; streamable performs the MCP HTTP lifecycle. */
  httpMode?: 'direct' | 'streamable';
  resumePostSse?: boolean;
  /** Explicit URL elicitation origins; no automatic navigation/fetch or credential sharing. */
  elicitationOrigins?: string[];
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  tokenEnv?: string;
  oauth?: {
    clientId?: string;
    authorizationUrl?: string;
    deviceAuthorizationUrl?: string;
    tokenUrl?: string;
    scopes?: string[];
    /** Explicit trusted issuer pin for metadata discovery. */
    issuer?: string;
    metadataUrl?: string;
    redirectUri?: string;
  };
}

export interface LspServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  /** File extensions handled by this server, for example [".ts", ".tsx"]. */
  extensions: string[];
  languageId: string;
  initializationOptions?: Record<string, unknown>;
}

export interface PlatformConfig {
  network: {
    proxyUrl?: string;
    allowedHosts: string[];
    caFile?: string;
    clientCertFile?: string;
    clientKeyFile?: string;
    rejectUnauthorized: boolean;
    timeoutMs: number;
  };
  remote: {
    enabled: boolean;
    serverUrl?: string;
    authTokenEnv: string;
    reconnectAttempts: number;
    reconnectDelayMs: number;
    pingIntervalMs: number;
    maxAttachmentBytes: number;
  };
  model: {
    provider: 'openai' | 'compatible' | 'anthropic';
    apiProtocol?: 'chat-completions' | 'messages' | 'responses';
    /** Explicit adapter for vendors without native Responses; never auto-fallback. */
    responsesTransport?: 'native' | 'chat-completions';
    /** Explicit deployment contract, never inferred from a private model alias. */
    chatToolReasoning?: 'preserve' | 'none' | 'omit' | 'responses-only';
    /** Server-side storage is opt-in. Local transcripts remain authoritative. */
    responsesStore?: boolean;
    responsesTextFormat?: { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict?: boolean } | null;
    apiKeyEnv?: string;
    /** Explicit Windows DPAPI vault reference, bound to the selected endpoint. */
    credentialRef?: string;
    credentialBackend?: 'windows-dpapi' | 'macos-keychain' | 'linux-secret-service';
    completionTokenField?: 'max_tokens' | 'max_completion_tokens';
    name: string;
    baseUrl?: string;
    endpointUrl?: string;
    apiKeyHeader?: string;
    apiKeyPrefix?: string;
    headersFromEnvironment?: Record<string, string>;
    maxContextTokens: number;
    /** Explicit local BPE text encoding; never guessed from private deployment aliases. */
    tokenizer?: 'cl100k_base' | 'o200k_base';
    audioInputFormats?:Array<'wav'|'mp3'>;
    tokenizerVocabulary?: { file: string; sha256: string; patternEncoding: 'cl100k_base' | 'o200k_base' | 'custom'; specialTokenMode?:'ordinary'|'allowed';timeoutMs?:number };
    contextFraming?: { baseTokens: number; perMessageTokens: number; perToolTokens: number };
    inputTokenCounting?: { mode:'responses'; onError?:'stop'|'estimate'; timeoutMs?:number } | null;
    maxOutputTokens: number;
    /** Sends a compatible reasoning-effort hint when the endpoint supports it. */
    thinkingEnabled: boolean;
    /** Provider-compatible reasoning effort selected by the interactive model picker. */
    reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    /** Requests the endpoint's priority/fast service tier when supported. */
    fastMode: boolean;
    availableModels?: string[];
  };
  policy: {
    mode: PermissionMode;
    workspaceRoots: string[];
    allowNetwork: boolean;
    allowedCommands: string[];
    deniedCommands: string[];
    protectedPatterns: string[];
    processWrapper?: string;
    /** Linux command/stdio isolation. Missing backend/unsupported OS fails closed. */
    osSandbox?: 'linux-bubblewrap';
    allowGitPush: boolean;
    allowPullRequests: boolean;
    allowedEnvironmentVariables: string[];
    commandTimeoutMs: number;
    permissionRules: { allow: string[]; ask: string[]; deny: string[] };
  };
  agents: {
    maxConcurrent: number;
    maxPerSession: number;
    maxDepth: number;
    defaultIsolation: 'none' | 'worktree';
    maxTurns: number;
    heartbeatTimeoutMs: number;
    worktreeCleanup: 'manual' | 'on-success' | 'always';
  };
  hooks: HookDefinition[];
  schedulerManagers?: {systemctl?:string;launchctl?:string};
  recoveryMaintenance?: {enabled:boolean;automatic?:boolean;retentionDays:number;minKeep:number;maxPrunePerRun:number};
  recoveryRemote?: {remote:string;expectedUrl:string;transport?:'ssh-wrapper';launcherDependencies?:string[]};
  messageDisplay?: { mode: 'message' | 'lines'; linesPerBatch?: number; maxBatches?: number };
  runtimeReplay?: import('./runtimeReplay.js').RuntimeReplayPolicy;
  mcpServers: Record<string, McpServerConfig>;
  /** Windows CurrentUser DPAPI storage for MCP tokens; opt-in, no plaintext fallback. */
  mcpCredentialBackend?: 'file' | 'windows-dpapi' | 'macos-keychain' | 'linux-secret-service';
  lspServers: Record<string, LspServerConfig>;
  skillsDirectories: string[];
  agentsDirectories: string[];
  pluginDirectories: string[];
  disabledPlugins: string[];
  disabledSkills?: string[];
  skillModes?: Record<string, 'auto' | 'manual' | 'disabled'>;
  skillOverrides?: Record<string, import('./skills.js').SkillVisibility>;
  disableBundledSkills?: boolean;
  pluginLocks?: Record<string, { version: string; digest: string }>;
  requirePluginLocks?: boolean;
  requirePluginSignatures?: boolean;
  pluginOverlays?: Record<string,import('./pluginOverlays.js').SignedPluginOverlay>;
  usePluginSets?: boolean;
  pluginRollout?: import('./pluginRollout.js').PluginRolloutPolicy;
  /** A higher-priority trust map REPLACES lower-priority keys, rather than merging. */
  pluginTrustKeys?: Record<string, string>;
  revokedPluginKeys?: string[];
  spending?: import('./spending.js').SpendingPolicy;
  modelRetry?: import('./modelRetry.js').ModelRetryPolicy;
  contextCompaction?: import('./semanticCompaction.js').CompactionPolicy;
  strictMcpConfig?: boolean;
  toolFilter?: string[] | null;
  ephemeralSession?: boolean;
  runtimeHistory?:{mode:'metadata'|'redacted';maxTextChars?:number};
  agentDefinitions?: Record<string, Omit<import('./agents.js').AgentDefinition, 'name' | 'path' | 'source' | 'plugin'>>;
  marketplaceEnabled?: boolean;
  outputStyle?: string;
  vimMode: boolean;
  coordinatorMode: boolean;
  ui: {
    autoCompact: boolean;
    showTips: boolean;
    reduceMotion: boolean;
    sessionRecap: boolean;
    rewindCode: boolean;
    verboseOutput: boolean;
    terminalProgressBar: boolean;
    showTurnDuration: boolean;
    worktreeBaseRef: 'fresh' | 'current';
    useAutoModeDuringPlan: boolean;
    respectGitignore: boolean;
  };
}

export interface ToolContext {
  /** Stable provider call identity, not a model-supplied retry permission. */
  operationId?: string;
  cwd: string;
  agentId: string;
  sessionId: string;
  teamSessionId?: string;
  taskId?: string;
  depth: number;
  config: PlatformConfig;
  /** Runtime capability intersection inherited by delegated/forked work. */
  capabilityTools?: string[];
}
