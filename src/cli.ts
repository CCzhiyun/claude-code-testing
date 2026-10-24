#!/usr/bin/env node
import packageMetadata from '../package.json' with { type: 'json' };
import { CLI_VALUE_OPTIONS } from './cliOptions.js';
import { parseCliInvocation } from './entrypoints/cli.js';
import { lstat, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { EventEmitter } from 'node:events';
import { initializeConfig, loadConfig, validateConfig, setSessionOverrides } from './config.js';
import { homeStateDir, projectStateDir } from './paths.js';
import { readCaCertificates } from './network.js';
import { API_PRESETS, apiPresetPatch, type ApiPreset } from './modelConnection.js';
import { configForDisplay } from './configDisplay.js';
import { modelDiagnostics } from './modelDiagnostics.js';
import { exportDiagnosticBundle } from './diagnosticBundle.js';
import { listModelCredentials, removeModelCredential, storeModelCredential } from './protectedModelCredentials.js';
import { listWakeups, cancelWakeup } from './automation.js';
import { responseRecord } from './responseRecords.js';
import { readPrintInput, runPrint, type PrintFormat } from './printMode.js';
import { listPermissionDenials } from './permissionHistory.js';
import { cancelAgent, continueAgent, listAgents, loadAgent, runAgentWorker, saveAgent, spawnAgent, waitForAgent } from './agent.js';
import { assertSessionIdle, compactSession, forkSession, listSessions, loadSession, saveSession } from './sessions.js';
import { exportSession } from './sessionExport.js';
import { startupSession, AmbiguousSessionNameError } from './sessionStartup.js';
import { formatContextSnapshot } from './contextBudget.js';
import { getMemory, listMemory, setMemory } from './memory.js';
import { invokeUserSkill } from './skillInvocation.js';
import { createTeam, listTeams, loadTeam, deleteTeam } from './teamStore.js';
import { discoverTeam, readTeamMailbox, sendTeamMessage, broadcastTeamMessage, requestTeamShutdown } from './mailbox.js';
import { computePluginDigest, installPlugin, validatePlugin, loadPluginAt } from './plugins.js';
import { installTrustedPlugin, listInterruptedPluginTransactions, recoverPluginTransaction, listPluginHistory, rollbackPlugin, snapshotPlugin } from './pluginHistory.js';
import { callMcpServer, configuredMcpServers, getMcpPrompt, inspectMcpServer, listMcpPrompts, listMcpResources, loginMcp, loginMcpDeviceFlow, logoutMcp, readMcpResource, saveMcpServer } from './mcp.js';
import { readAudit } from './audit.js';
import { loadWorkflow, runWorkflow } from './workflow.js';
import { serveIdeBridge } from './ide.js';
import { runHooks } from './hooks.js';
import { readJson, writeJson } from './storage.js';
import { runTui, type TuiInitialSession } from './tui.js';
import { setSessionTokenLimits } from './config.js';
import type { PermissionMode, PlatformConfig } from './types.js';
import { loadPlatform, expandCommand } from './platform.js';
import { createAgentScaffold, createMcpScaffold, createPluginScaffold, createSkillScaffold, initializePlatform, installFoundationPlugin, platformGuide } from './scaffold.js';
import { inspectGitConflicts, listWorktreeRecoveries, restoreWorktreeRecovery, mergeWorktree, removeWorktree } from './worktree.js';
import { installVsCodeExtension } from './ide-install.js';
import { claimTask, listTasks, loadTask } from './tasks.js';
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from './checkpoints.js';
import { getShellTaskOutput, runShellTaskWorker, startShellTask, stopShellTask } from './tasks/LocalShellTask/LocalShellTask.js';
import { executeLspRequest } from './services/lsp/manager.js';
import { formatLspResult } from './tools/LSPTool/formatters.js';
import { getOutputStyleDirStyles } from './outputStyles/loadOutputStylesDir.js';
import { fetchLatestEvents, fetchOlderEvents } from './assistant/sessionHistory.js';
import { getRuntimeState } from './bootstrap/state.js';
import { addMarketplace, ensureOfficialMarketplace, installMarketplacePlugin, listMarketplacePlugins, listMarketplaces, marketplaceErrors, refreshMarketplace, removeMarketplace, setMarketplaceAutoUpdate, uninstallMarketplacePlugin, updateMarketplacePlugin } from './marketplace.js';
import { inspectMarketplaceInstallations, repairMarketplaceReceipt } from './marketplace.js';
import { evaluatePermission } from './utils/permissions/permissions.js';
import { explainPermission } from './utils/permissions/permissionExplainer.js';
import { createDirectConnectSession } from './server/createDirectConnectSession.js';
import { listRemoteSessions, saveRemoteSession } from './server/sessionStore.js';
import { listTrustedDevices, revokeTrustedDevice, trustDevice } from './bridge/trustedDevice.js';
import { usageInsights } from './usage.js';
import { listArtifacts } from './artifacts.js';
import { listChannels } from './channels.js';
import { listRoutineRuns, listRoutines } from './automation.js';
import { loadSurfaceRegistry, surfaceHealth } from './integrations/surfaces.js';
import { ensureProjectClaudeInstructions, ensureUserClaudeInstructions, ensureUserSettings } from './workspaceTrust.js';
import { listPlanRecords, loadProjectPlan, transitionProjectPlan, updateProjectPlanStep } from './plans.js';
import { executeProjectPlan, recoverProjectPlanExecution } from './planExecution.js';
import { recoveryPage, pruneWorktreeRecovery, conflictGuide, conflictVersions, stageResolvedConflict } from './worktree.js';
import { createRecoveryBackup, inspectRecoveryBackup, importRecoveryBackup } from './recoveryBackup.js';
import { listPluginOrphans, quarantinePluginOrphan } from './pluginOrphans.js';

const VERSION = packageMetadata.version;
const shortFlags: Record<string, string> = { '-c': '--continue', '-r': '--resume', '-h': '--help', '-v': '--version' };
const rawArgs = process.argv.slice(2).map(arg => shortFlags[arg] ?? arg);
const optionsWithValues = new Set<string>(CLI_VALUE_OPTIONS);

function flag(name: string): boolean { return rawArgs.includes(`--${name}`); }
function option(name: string, fallback?: string): string | undefined {
  const index = rawArgs.indexOf(`--${name}`);
  return index >= 0 ? rawArgs[index + 1] : fallback;
}
function collectPositionals(): string[] {
  const values: string[] = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const value = rawArgs[index];
    if (!value) continue;
    if (value === '-p') continue;
    if (value.startsWith('--')) {
      if (optionsWithValues.has(value.slice(2)) && (value !== '--resume' || (rawArgs[index + 1] !== undefined && !rawArgs[index + 1]!.startsWith('-')))) index += 1;
      continue;
    }
    values.push(value);
  }
  return values;
}
const args = collectPositionals();
function positional(start: number): string[] { return args.slice(start); }

function print(value: unknown): void {
  process.stdout.write(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

function help(command?: string): void {
  if (command === 'skills') command = 'skill';
  const sections: Record<string, string> = {
    model: 'model test [--connectivity-only] [--stream] [--tools-check|--full-tools-check] [--diagnostics] [--timeout 20000]\nTemporary connection: --api-preset messages|chat-completions|responses|azure-openai|azure-responses --endpoint-url <url> --model <deployment>\nCredentials: --api-key-env <VARIABLE> [--api-key-header api-key] [--api-key-prefix <prefix>]\nAlso accepts --settings <JSON-or-file>. Managed configuration wins. No repository context, Skills, Hooks or MCP execution.\n--full-tools-check registers every built-in schema, but only a fixed echo can execute. Does not test external plugin/MCP tools.\n--diagnostics includes sanitized provider message/code/param/requestId; review before sharing.\nWithout --connectivity-only, sends one paid model request (two with either tools check; full catalog consumes more input tokens). Connectivity-only is unauthenticated HEAD; it does not verify protocol/model support.\nExit: 0 successful diagnostic, 1 failed. Does not change the active chat or saved model settings.',
    skill: 'skill list\nskill show <name>\nskill create <name>\nskill mode <name> auto|manual|disabled\nskill visibility <name> on|name-only|user-invocable-only|off\nskill run <name> [arguments] [--agent-id <existing-agent>] [--background]\nInline Skills retain the supplied Agent conversation. context: fork creates an isolated subagent. Skill restrictions never grant permissions.',
    teams: 'teams list\nteams create <lead-agent> <name>\nteams members|inbox <agent>\nteams send <from-agent> <to-agent> <message>\nteams broadcast <from-agent> <message>\nteams shutdown <lead-agent> <member-agent>\nteams cleanup <team-id> confirm\nMailboxes are data only, never human permission grants. Cleanup preserves conversations and files and refuses active teams.',
    budget: 'budget <team-session-id>\nShows model request counts, reconciled usage and outstanding reservations. Prices are operator-configured estimates, not provider invoices. Unknown usage retains its reservation.',
    config: 'config show\nconfig set [--global] --api-preset messages|chat-completions|responses|azure-openai|azure-responses --endpoint-url <url> --model <deployment>\nconfig set [--global] --api-key-env <VARIABLE> --api-key-header api-key\nconfig set [--global] --ca-file <file.pem>\nconfig set [--global] --responses-store enabled|disabled\nconfig set [--global] --response-schema <format.json> | --clear-response-schema\nconfig set [--global] --marketplace enabled|disabled\nSettings are validated before saving. config show redacts secret fields and environment values.',
    agents: 'agents\nagents <id>\nagents wait|attach|logs|stop|cancel <id>\nagents cleanup <id> [--merge]\nagents recovery-list\nAgent records include status, workspace and session IDs. Stop does not revert file changes. Recovery refs are local, not proof of a push.',
    mcp: 'mcp list\nmcp create <name>\nmcp add <name> --url <url> [--http-mode direct|streamable]\nmcp add <name> --command <executable> --args <comma-separated-arguments>\nmcp test <name>\nmcp watch <name> [--timeout 60000] [--max-events 1000] [--max-reconnects 5]\nWatch: negotiated 2025 Streamable HTTP GET/SSE, NDJSON notifications, Ctrl+C stops; no model/tool execution.\nmcp call <name> <tool> --json <JSON-input>\nmcp login <name> (token on stdin)\nmcp oauth-login <name> (device flow)\nmcp logout <name>\nmcp migrate-credentials (explicit Windows DPAPI migration)\nSettings: mcpCredentialBackend=file|windows-dpapi. Protected-store failure never falls back to plaintext.\nInspect configuration before invoking tools; tool calls can affect external systems.',
    plugin: 'plugin list\nplugin create <name>\nplugin validate <path>\nplugin install <path>\nplugin lock <reviewed-local-path>\nplugin sign <path> --key-file <external-ed25519-private.pem> --key-id <publisher-key>\nplugin verify\nplugin update <name>\nplugin uninstall <name>\nUse requirePluginLocks=true for approved versions/digests and requirePluginSignatures=true with administrator-owned pluginTrustKeys for publisher verification. revokedPluginKeys blocks revoked publishers. Private signing keys must stay outside the plugin. Signatures do not grant redistribution rights.',
    sessions: 'sessions\nsessions context <id>\nsessions compact <id>\nsessions export <id> <file.md|file.json>\nsessions fork <id> [--title <title>]\nsessions resume <id> [prompt]\nUse -p <prompt> --resume <id> [--fork-session] for machine-readable execution.',
    responses: 'responses get <response-id>\nresponses delete <response-id> --confirm\nRequires model.apiProtocol=responses and the original trusted endpoint/credential. Delete is irreversible on the server, but does not delete local history.',
    print: '-p|--print <prompt> [--output-format text|json|stream-json]\n--input-format stream-json --output-format stream-json (NDJSON user/cancel frames on stdin)\n--resume <session-id> [--fork-session]\n--append-system-prompt <text> | --append-system-prompt-file <path>\n--settings <file-or-JSON> --mcp-config <file-or-JSON> [--strict-mcp-config]\n--agents <file-or-JSON> --agent <name> --plugin-dir <workspace-plugin-parent>\n--tools <comma-separated-names> --max-requests <count> --budget-usd <amount>\n--no-session-persistence (print only; no resume/fork/worktree/background)\n--restricted | --permission-mode <mode> (managed policy wins)\nPipe UTF-8 stdin when no prompt is given (maximum 1 MiB).\nExit codes: 0 completed, 2 waiting for input/permission/context/budget/capacity, 1 failed. No permission bypass is implied.',
  };
  sections.mcp += '\n\nAuthorization code: mcp oauth-discover <name>\nmcp oauth-login <name> --flow code [--timeout 300000]\nmcp oauth-login <name> --flow code --manual --redirect-uri <registered-callback> [--register]\nDiscovery requires oauth.issuer pin; --register explicitly permits public-client registration. No automatic browser launch.\nmcp add accepts --oauth-issuer, --oauth-client-id, --oauth-authorization-url, --oauth-token-url, --oauth-metadata-url.\nCallback codes never belong in CLI arguments. Credentials are bound to the original resource/client/token endpoint.';
  sections.mcp += '\n\nmcp call <server> <tool> --interactive [--json <arguments>]\nExplicit real-terminal interaction for stdio or Streamable HTTP POST/SSE: sampling requires approval before model use AND before sharing the result; simple non-sensitive forms require confirmation. No local tool execution, live conversation inclusion or session-wide approvals. URL/tool sampling needs the separate opt-ins below. Defaults remain deny.';
  sections.model += '\n\nmodel acceptance --confirm [--timeout 20000] [--diagnostics] [connection options]\nUp to 7 paid requests: ordinary/multi-turn chat, all built-in schemas with a fixed safe echo roundtrip, streaming and cancellation. Stops at the first failure; never switches protocol or runs generated shell/filesystem tools. No project context is sent. Budget metadata may be recorded.';
  sections.plugin += '\n\nplugin snapshot <name> [--scope project|local]\nplugin history <name> [--scope project|local]\nplugin rollback <name> <revision_ID> --confirm [--scope project|local]\nUpdates/uninstalls retain previous bytes. Rollback checks current signatures, revocation and locks; current bytes are also archived.\nSigned artifacts must be installed directly: marketplace manifest overlays cannot preserve their integrity envelope.';
  sections.plugin += '\nplugin transactions\nplugin recover <transaction-id> --confirm\nRecovery verifies backup bytes and current trust; it never overwrites an installed plugin.';
  sections.plugin += '\nplugin orphans\nplugin quarantine <transaction-id> --expected-digest <sha256> --confirm\nJournal-less staging is only inspected/quarantined, never guessed into an installation. Quarantine is reversible and refuses active/unknown legacy operation locks.';
  sections.plugin += '\nplugin sources\nplugin repair-source <name>@<marketplace> --confirm [--scope project|local]\nSources is read-only local attribution health. Repair only uses the explicitly selected local/cached catalog with identical signed bytes and current trust; it never downloads or infers provenance. Receipts do not grant redistribution rights.';
  sections.credentials = 'credentials list\ncredentials set <name> --from-env ENV_NAME\ncredentials set <name> --stdin (pipe secret-manager output; never echo a real key in shell history)\ncredentials remove <name>\nSelect model.credentialBackend=windows-dpapi|macos-keychain|linux-secret-service. Key input is never a CLI argument. Reference is endpoint-bound; settings are not automatically changed. Native stores need their matching OS/unlocked service and support <=5000 bytes per entry; failure never falls back to plaintext.';
  sections.mcp+='\nIndependent GET human review: mcp watch NAME --interactive [--max-interactions 8]. Explicit TTY approvals; default remains notifications only. Optional server.resumePostSse=true resumes broken POST SSE using GET+cursor, never repeats the original tool POST.';
  sections.plugin+='\nplugin overlay-sign PATH --json CONTRIBUTIONS --key-file PRIVATE_PEM --key-id PUBLISHER\nCopy the returned envelope to settings.pluginOverlays[pluginName]. Artifact and overlay are independently signed/revocation-checked; overlays augment contributions without rewriting artifact bytes. Not a cross-plugin transaction.';
  sections['plugin-set']='plugin-set stage --json ["./plugin-a","./plugin-b"] --confirm\nplugin-set stage-marketplace --json ["plugin-a@catalog","plugin-b@catalog"] --confirm\nplugin-set inspect [pluginset_ID]\nplugin-set activate|rollback pluginset_ID --expected-version N --confirm\nStage immutable artifacts AND receipts, then atomically CAS-select one complete generation. Marketplace staging accepts explicitly selected signed artifacts with separately signed team overlays; it does not mutate publisher bytes or activate automatically. Enable settings.usePluginSets=true after first activation. Rollback revalidates current signatures/revocation/locks; conflicting explicit settings overlays block switching. No background downloads, plugin code execution, adoption of interrupted staging or crash-durability guarantee.';
  sections.mcp+='\nMCP 2025-11-25 URL consent: add server.elicitationOrigins (exact HTTPS origins), then mcp call/watch NAME ... --interactive --interactive-url. Manual browser navigation only, no credential collection; accept is not completion. Budgeted tool sampling below supports text/image requests; audio input is opt-in for explicitly audio-capable Chat Completions deployments, with --interactive-audio and server samplingBudget.audio=true. Downgrade disables newer capabilities.';
  sections.agents+='\nagents recovery-maintenance [plan|run --expected-digest DIGEST --confirm]\nagents recovery-remote prepare --confirm\nagents recovery-remote run ID --expected-digest DIGEST --confirm\nagents recovery-remote query ID --confirm\nExplicit settings.recoveryMaintenance and pinned recoveryRemote required. Pruning first exports a complete bundle and atomically verifies retaining refs. Remote upload exposes committed history, needs allowGitPush, and never replays unknown receipts.';
  sections.audit='audit [YYYY-MM-DD]\naudit verify [--day YYYY-MM-DD] [--anchor EXTERNALLY_SAVED_TAIL_MAC]\nOpt-in: CCPT_AUDIT_INTEGRITY=required and CCPT_AUDIT_HMAC_KEY (32–64 bytes hex). Tamper-evident local chain only; external anchors/central trusted storage remain administrator responsibilities.';
  sections.agents+='\nagents conflict-review PATH\nagents conflict-stage-binary PATH --expected-version REVIEW --confirm\nReview manually resolved binary bytes or deletion, then explicitly stage. No ours/theirs selection, commit or push.';
  sections.agents+='\nagents conflict-resolve PATH --choice ours|theirs|working|delete --expected-version REVIEW --confirm\nExplicit exact-byte side/deletion selection with retained original index/working backup and exclusive Git index lock. TUI: /resolve-conflict PATH.';
  sections.wakeups = 'wakeups [list]\nwakeups doctor\nwakeups cancel <id>\nwakeups repair\nwakeups repair --confirm --expected-digest <sha256>\nRepair previews a checked write-ahead checkpoint, retains corrupt original bytes and pauses pending work. No automatic replay. Listing/doctor is read-only. Due context is delivered on resume/next worker turn, not by an OS daemon.';
  sections.automation = 'automation list\nautomation status <id>\nautomation prepare [--minutes 5] [--repair-corrupt]\nautomation install <id> --confirm\nautomation tick <id>\nautomation disable <id> --confirm\nautomation rebind <id> --expected-digest <status-digest> --confirm\nautomation uninstall <id> --expected-digest <status-digest> --confirm\nWindows current-user Task Scheduler. Context delivery only: no models/tools. Rebind disables the old ID and prepares a new definition; explicitly install the replacement. Uninstall verifies the exact OS action/principal, disables local delivery, and retains state/evidence. Failed OS queries are not treated as proof of absence.';
  sections.extensions = 'extensions list\nextensions trust <absolute-directory> --kind skill|agent|plugin --confirm\nextensions untrust <absolute-directory> --kind skill|agent|plugin --confirm\nOnly user settings may select approved global roots. Project overrides stay workspace-confined. Revocation fails closed; remove revoked roots from user settings before continuing.';
  sections.notifications = 'notifications list [--offset 0 --limit 50] [--unread]\nnotifications read <id> --expected-version <list-version> --confirm\nLocal workspace notification center. Reading the list is side-effect free. Acknowledgement is versioned and never grants permission.';
  sections['event-outbox']='event-outbox recover --cwd PROJECT\nRecover committed Plan/notification/task/team/Agent/mailbox metadata intents. Snapshot+intent share one atomic rename; reconnect drains with stable producer checkpoints. Pending capacity 256 per queue; 4096 producer checkpoints never evicted, 1024 visible invalidations. Bounded home discovery; no business-operation, approval or model replay. Not unlimited history or a power-loss/fsync guarantee.';
  sections['plugin-set']+='\nplugin-set inventory\nplugin-set preview ID\nplugin-set apply ID --expected-digest REVIEW_SHA256 --confirm\nplugin-set recover .pending-NAME --expected-digest INVENTORY_REVIEW_SHA256 --confirm\nReview binds current generation, artifact/overlay changes and effective configuration. Recover only a complete publisher-signed pending set after current trust verification; no automatic activation or incomplete-stage adoption.';
  sections['plugin-set']+='\nplugin-set migration-preview --json [{"name":"team","scope":"project","revisionId":"revision_OPTIONAL"}]\nplugin-set migrate --json SELECTION --expected-digest REVIEW_SHA256 --confirm\nCopies reviewed installed/history bytes into a new immutable generation under current signature/lock/revocation policy. Preserves legacy artifacts/history; never activates or enables automatically.';
  sections.mcp+='\nBudgeted tool sampling: configure mcpServers.NAME.samplingBudget={maxRequests:4,maxReservedTokens:1000000,tools:true}, then mcp call/watch NAME ... --interactive --interactive-tools. Request and share each require human approval. Server-defined tool calls return to the server; no local execution or live chat inclusion. Conservative full-window reservations, unknown costs retained; Responses/Chat support auto/none/required tool choice; audio input additionally requires model.audioInputFormats, server samplingBudget.audio and --interactive-audio. No Responses/endpoint fallback. Optional spending.account shares a local cap across CLI processes; budget account:NAME inspects it.';
  sections.model+='\nmodel enterprise-acceptance --confirm --max-requests 12 --max-tokens 16000000 [--timeout 20000]\nUp to nine actual paid requests: existing protocol suite plus one real fixture read/result continuation through the actual tool dispatcher. Preserves model/URL/CA/proxy/mTLS/policy, caps HTTP attempts/tokens and stops on failure. Managed hooks remain active. No company certification is inferred.';
  sections['context-benchmark']='context-benchmark [--tokens 1000000] [--encoding cl100k_base|o200k_base]\nLocal BPE throughput only; 1000–1000000 generated tokens. Zero model requests; not a model/summary-quality or enterprise-repository benchmark.';
  sections.sessions+='\nsessions replay SESSION_ID [--cursor GENERATION:SEQUENCE] [--limit 100] [--include-text]\nOpt-in runtimeReplay journal. Metadata by default; raw delta text requires explicit plaintext settings acknowledgement. TUI /replay and IDE runtime/replay read the same journal; no historical actions execute.';
  sections['plugin-set']+='\nplugin-set rollout-preview GENERATION\nplugin-set rollout-prepare GENERATION --expected-digest DIGEST --confirm\nplugin-set rollout-apply ROLLOUT --expected-version N --confirm\nplugin-set rollout-reconcile ROLLOUT --expected-version N --confirm\nplugin-set rollouts|rollout-check\nExplicit pluginRollout exact-version channel, publisher signatures and expiring approval. Configured rollout policy blocks legacy activation/rollback bypass; background checks are local and never activate/download.';
  sections.agents+='\nagents conflict-restore-preview conflict_ID\nagents conflict-restore conflict_ID --expected-digest REVIEW_SHA256 --confirm\nTUI: /undo-conflict conflict_ID. Restores exact original working/index bytes only while current resolution and HEAD are unchanged. Retains before/after backups; unknown restore never replays.';
  sections['audit-checkpoint']='audit-checkpoint publish|query --collector-file CONFIG_JSON --day YYYY-MM-DD --confirm\nExplicit authenticated HTTPS collector, pinned Ed25519 receipts, verified local HMAC chain. Exports MAC metadata only, never audit bodies. Query unknown POST results; no automatic POST retry. Separate administrator-owned collector and signing-key custody are required; reference storage is not WORM or enterprise acceptance.';
  sections['audit-collector']='audit-collector serve --collector-file ADMIN_CONFIG --port 8443 [--host 127.0.0.1|::1] --confirm\nForeground administrator collector with TLS/mTLS, per-stream bearer grants, bounded requests, idempotency and signed append-only checkpoints. CLI binds loopback; configure an administrator-controlled TLS deployment for remote access. No OS service installation or WORM guarantee.';
  sections['context-eval']='context-eval --fixture CASES_JSON --confirm --max-requests N --max-tokens N\nPaid selected-model factual-retention evaluation on explicitly shared fixture source. Trusted workspace required. Reports hashes/coverage, not source or generated summary. Does not prove semantic equivalence or native 1M capacity.';
  sections['plugin-set']+='\nplugin-set health\nplugin-set remediation-preview SIGNED_GENERATION\nplugin-set remediate SIGNED_GENERATION --expected-digest REVIEW_SHA256 --confirm\nEmergency repair of revoked/tampered active generations. Replacement must have trusted publisher signatures and satisfy current channel/removal policy. Exact pointer/config/artifact digest CAS; old bytes preserved, no plugin code executes.';
  sections.mcp+='\nmcp acceptance SERVER --confirm --max-requests 8 --timeout 20000\nOne negotiated target session: ping, bounded paginated tool/resource/prompt catalogs and tool-schema validation. No tools/call, resource content, model sampling or browser launch. Probe request cap excludes initialization and cleanup; no company certification is inferred.';
  sections.automation += '\nCurrent-host registration: Windows Task Scheduler, Linux user systemd, macOS user launchd. No root/system service.\nautomation prepare --agent-mode read-only --max-requests N --max-tokens N [--max-runs 3]\nautomation runs <id>\nRead-only mode is explicit paid-model opt-in. Lifetime requests/tokens/runs are bounded; only file reads/search, no shell/write/MCP/plugin/delegation tools. Independent report sessions preserve the original conversation. Unknown claims are never replayed automatically.';
  sections.automation += '\nautomation recover <id> [--expected-digest DIGEST --confirm]\nNative recovery previews nonce-bound interrupted installations only; no automatic replay or adoption of legacy files.';
  sections.automation+='\nautomation prepare-goal goalrun_ID --expected-version N --at ISO --confirm\nautomation prepare-backup --max-runs N --minutes 60 --at ISO --confirm\nautomation workflow-runs scheduler_ID\nautomation backup-reconcile scheduler_ID --expected-digest DIGEST --confirm\nPrepare never registers OS jobs; use install ID --confirm separately. Approved Goal launches once, keeps original budget and waits for human permission. Scheduled uploads are bounded; unknown effects halt without replay. schedulerManagers.systemctl/launchctl select pinned root-owned native executables.';
  sections.automation+='\nautomation migration-preview scheduler_ID\nautomation migrate scheduler_ID --expected-digest DIGEST --confirm\nLegacy unbound entries cannot tick/install. Migration binds this CLI as a new unregistered context-only job, disables the old ID, retains OS definitions/evidence, and never moves wakeups or reuses paid approval. Unknown preparation is not replayed.';
  sections['goal-run']='goal-run prepare --goal-id ID --plan-id ID --expected-plan-version N --tools read_file,write_file,run_command --max-requests N --max-tokens N [--max-attempts 3] --confirm\ngoal-run show ID\ngoal-run start ID --expected-version N --confirm [--foreground]\ngoal-run resume ID --expected-version N (--approve-request ID|--feedback TEXT) [--verified-unknown] --confirm\ngoal-run recover ID --expected-version N\ngoal-run cancel ID --expected-version N --confirm\nPaid approved-Plan coding opt-in, original idle conversation, cumulative budget and exact approval. Resume prepares only; start executes. Persistent validated settings only; temporary policy/model/settings overrides are rejected, not silently ignored. Unknown effects require human verification; no automatic replay/refund.';
  sections['goal-run']+='\ngoal-run list\nTUI: /goal-run prepare opens the local Plan/budget/tools wizard; /goal-run start|resume|recover|cancel ID opens a version-bound confirmation. VS Code: CCPT: Goal Workflows. No model/Agent question can construct a local approval dialog.';
  sections.operations='operations list|show ID|query ID\noperations resolve ID --status completed|not_applied --reason TEXT --expected-version N --confirm\noperations compensate ID --reason TEXT --expected-version N --confirm\nWrite-ahead external operation receipts. MCP idempotency/status/compensation requires an administrator-declared server protocol. Git compensation uses only a clean exact receipt HEAD revert. No force-push or guessed inverse command.';
  sections.sessions='sessions preview ID [--include-text --text-limit 16000 --limit 50 --cursor CURSOR]\nsessions activity ID [--include-text --limit 100 --cursor CURSOR]\nSaved view only; no model/tool replay or permission grants. Runtime text must have been explicitly captured with runtimeHistory.mode=redacted; default is metadata. Bounded retention can report reset.';
  sections.hooks = 'hooks list\nhooks matrix\nhooks run <event>\nMatrix documents this dispatcher only, not full reference parity. Unknown events are rejected. Command exit 2 blocks/retries; other nonzero exits fail closed. Plugins report their source; async completion gates are rejected.';
  sections.doctor = 'doctor\ndoctor errors [--limit 1–100]\ndoctor export <filename>\nErrors shows recent bounded/redacted model failures. Export includes the last ten errors and refuses to overwrite existing files. Review before sharing. Neither sends a model request.';
  sections.agents += '\nagents conflicts\nagents recover <managed-ref> <new-branch> --confirm\nRecovery creates only a new local branch; it does not checkout, overwrite or push.';
  sections.agents += '\nagents recovery-backup --confirm\nagents recovery-backup-check <directory> --expected-sha256 <sha256>\nagents recovery-import <directory> --expected-sha256 <sha256> --ref <managed-ref> --branch <new-local-branch> --confirm\nBackups contain committed history, not working edits/settings. Move them through an approved channel; verify a separately trusted digest. Import never overwrites a branch, checks out or accesses the network.';
  sections.agents += '\nagents recovery-page [--offset 0 --limit 50]\nagents recovery-prune <exact-ref> --expected-commit <oid> --confirm\nagents conflict-guide <path>\nagents conflict-versions <path>\nagents conflict-stage <path> --expected-version <digest> --confirm\nConflict-versions is a read-only base/ours/theirs object-ID/mode/size view for binary and deletion conflicts. Pruning requires a retaining branch/tag. Conflict-stage handles manually edited UTF-8 files only; commands never choose ours/theirs or commit/push.';
  if (command && sections[command]) { print(`CCPT ${VERSION} · ${command}\n\n${sections[command]}`); return; }
  print(`CCPT ${VERSION} — enterprise multi-agent coding CLI

Usage:
  ccpt init
  ccpt run <goal> [--background|--bg] [--worktree|--no-worktree] [--restricted]
  ccpt [--max-context <tokens>] [--max-output <tokens>]
  ccpt --continue|-c | --resume|-r [session-id-or-name] [--fork-session]
  ccpt --model <deployment> --effort low|medium|high|xhigh|max
  ccpt --tools default|<comma-separated-exact-names> (empty string disables tools)
  ccpt --max-budget-usd <amount> (requires configured model pricing)
  ccpt --print <prompt> [--output-format text|json|stream-json] [--restricted]
  ccpt -p <prompt> [--resume <session-id>] [--fork-session]
  ccpt -p <prompt> [--append-system-prompt <text>] [--append-system-prompt-file <path>]
  ccpt --bg <goal>
  ccpt agents [<id>|wait|attach|logs|stop|cancel|cleanup <id> [--merge]|recovery-list]
  ccpt attach|logs|stop <agent-id>
  ccpt plan <list|show|approve|changes|reject|cancel|execute|step> ...
  ccpt tasks [show <task-id>|claim <task-id> <agent-id>]
  ccpt insights|usage [session-id]
  ccpt artifacts
  ccpt channels
  ccpt routines
  ccpt shell <start|output|stop> ...
  ccpt team <team-session-id> <members|inbox <agent-id>|send <from-agent-id> <to-agent-id> <message>>
  ccpt checkpoint <create|list|restore> [id|files...] [--conversation|--conversation-only]
  ccpt workflow run <workflow.json>
  ccpt goal-run <prepare|show|start|resume|recover|cancel> ... (see --help)
  ccpt operations <list|show|query|resolve|compensate> ... (see --help)
  ccpt sessions [show <id>|fork <id>|resume <id> [goal]]
  ccpt sessions context <id>
  ccpt sessions compact <id>
  ccpt sessions export <id> <path.md|path.json>
  ccpt config set [--global] --marketplace enabled|disabled
  ccpt config set [--global] --ca-file <certificate.pem> | --clear-ca
  ccpt config set [--global] --api-protocol messages|chat-completions|responses --endpoint-url <url>
  ccpt config set [--global] --api-preset messages|chat-completions|responses|azure-openai|azure-responses --endpoint-url <url>
  ccpt config set [--global] --chat-tool-reasoning preserve|none|omit|responses-only
  ccpt config set [--global] --responses-store enabled|disabled
  ccpt config set [--global] --responses-transport native|chat-completions
  ccpt config set [--global] --response-schema <format.json> | --clear-response-schema
  ccpt config set [--global] --api-key-env <VARIABLE> --api-key-header api-key
  ccpt config set [--global] --token-field max_tokens|max_completion_tokens
  ccpt config set [--global] --max-context <tokens> --max-output <tokens>
  ccpt memory <list|get|set> [scope] [key] [value]
  ccpt skill <create|list|show> [name]
  ccpt agent <create|list|show|run> [name] [goal]
  ccpt plugin <create|list|show|validate|hash|install|uninstall|enable|disable|marketplace> ...
  ccpt mcp <create|list|add|test|login|oauth-login|logout|call> ...
  ccpt mcp add <name> http --url <url> --http-mode direct|streamable
  ccpt lsp <list|add|query> ...
  ccpt output-style <list|set|show> [name]
  ccpt coordinator <on|off|status>
  ccpt remote <create|list|trust|revoke> ...
  ccpt permissions <list|check> [tool] [--json input]
  ccpt stats
  ccpt platform <init|inspect|guide>
  ccpt surface <list|health [name]|invoke <name> <action> [--json input]>
  ccpt command <name> [arguments]
  ccpt hooks <list|run|matrix> [event]
  ccpt config <show|set> [model options] [--allow-host HOST] [--allow-git-push|--deny-git-push] [--allow-pull-requests|--deny-pull-requests]
  ccpt audit [YYYY-MM-DD]
  ccpt ide <serve|install>
  ccpt doctor
  ccpt model test [--connectivity-only|--stream|--tools-check] [connection options]
  ccpt responses get <response-id>
  ccpt responses delete <response-id> --confirm

Environment:
  CCPT_API_KEY, CCPT_MESSAGES_API_KEY, AZURE_OPENAI_API_KEY,
  CCPT_REMOTE_TOKEN, CCPT_HOME,
  CCPT_MANAGED_CONFIG, HTTPS_PROXY/HTTP_PROXY.`);
}

async function init(cwd: string): Promise<void> {
  await Promise.all([ensureUserSettings(), ensureUserClaudeInstructions(), ensureProjectClaudeInstructions(cwd)]);
  const path = await initializeConfig(cwd);
  const state = await initializePlatform(cwd);
  const foundation = await installFoundationPlugin(cwd);
  await runHooks(await loadConfig(cwd), 'Setup', { cwd }, cwd);
  print(`Initialized ${path}\nExtension workspace: ${state}\nFoundation workflows: ${foundation}`);
}

async function doctor(cwd: string): Promise<void> {
  const platform = await loadPlatform(cwd);
  const config = platform.config;
  const requestedModel = option('model');
  if (requestedModel) config.model.name = requestedModel;
  const checks: Array<{ check: string; ok: boolean; detail: string }> = [];
  try { checks.push({ check: 'git', ok: true, detail: execFileSync('git', ['--version'], { encoding: 'utf8' }).trim() }); }
  catch { checks.push({ check: 'git', ok: false, detail: 'git not found' }); }
  checks.push(...await modelDiagnostics(config));
  checks.push({ check: 'workspace roots', ok: config.policy.workspaceRoots.length > 0, detail: config.policy.workspaceRoots.join(', ') });
  checks.push({ check: 'skills', ok: true, detail: `${platform.skills.length} loaded` });
  checks.push({ check: 'agents', ok: true, detail: `${platform.agents.length} loaded` });
  checks.push({ check: 'plugins', ok: platform.diagnostics.every((item) => item.severity !== 'error'), detail: `${platform.plugins.length} loaded; ${platform.diagnostics.length} diagnostics` });
  const analysis = resolve(cwd, 'docs', 'analysis', 'snapshot-analysis.json');
  try {
    const report = JSON.parse(await readFile(analysis, 'utf8')) as { totals?: { unresolvedLocalImports?: number } };
    const missing = report.totals?.unresolvedLocalImports ?? 0;
    checks.push({ check: 'reference snapshot closure', ok: missing === 0, detail: `${missing} unresolved local imports (not part of enterprise CLI build)` });
  } catch { /* A clean standalone checkout has no reference snapshot. */ }
  print(checks);
  if (checks.some((check) => !check.ok && check.check !== 'reference snapshot closure')) process.exitCode = 1;
}

function interactiveHelp(): void {
  print(`Interactive commands:
  /help       Show this help
  /init       Initialize CCPT in the current project
  /agents     Show agent status
  /sessions   Show saved sessions
  /config     Show model and policy configuration
  /status     Show the active interactive agent
  /clear      Start a fresh conversation
  /exit       Exit CCPT

Any other input is sent to the active coding agent.`);
}

async function interactive(cwd: string, initial?: TuiInitialSession): Promise<void> {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    await runTui(cwd, VERSION, initial);
    return;
  }
  if (initial?.picker) throw new Error('The session picker requires an interactive terminal. Use --resume <session-id-or-name> instead.');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  let activeAgentId: string | undefined;
  let resumedSessionId = initial?.sessionId ? (initial.fork ? (await forkSession(initial.sessionId)).id : initial.sessionId) : undefined;
  print(`CCPT ${VERSION}
Workspace: ${cwd}
Type /help for commands. Describe a coding task to begin.`);
  try {
    while (true) {
      let answer: string;
      try {
        answer = await input.question('\nCCPT > ');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_USE_AFTER_CLOSE' || String(error).includes('readline was closed')) break;
        throw error;
      }
      const line = answer.trim();
      if (!line) continue;
      if (line === '/exit' || line === '/quit') break;
      if (line === '/help') { interactiveHelp(); continue; }
      if (line === '/init') { await init(cwd); continue; }
      if (line === '/agents') {
        print((await listAgents()).map(({ id, role, status, goal, updatedAt, result, error }) => ({ id, role, status, goal, updatedAt, summary: result ?? error })));
        continue;
      }
      if (line === '/sessions') {
        print((await listSessions()).map(({ id, parentId, title, updatedAt }) => ({ id, parentId, title, updatedAt })));
        continue;
      }
      if (line === '/config') {
        const config = await loadConfig(cwd);
        print(configForDisplay({ model: config.model, policy: config.policy }));
        continue;
      }
      if (line === '/status') {
        print(activeAgentId ? await loadAgent(activeAgentId) : 'No active conversation.');
        continue;
      }
      if (line === '/clear') {
        activeAgentId = undefined;
        resumedSessionId = undefined;
        print('Started a fresh conversation.');
        continue;
      }
      process.stdout.write('CCPT is working...\n');
      const config = await loadConfig(cwd);
      const record = activeAgentId
        ? await continueAgent(activeAgentId, line)
        : await spawnAgent({ goal: line, cwd, config, role: 'lead', isolation: 'none', background: false, ...(resumedSessionId ? { sessionId: resumedSessionId } : {}) });
      resumedSessionId = undefined;
      activeAgentId = record.id;
      if (record.status === 'completed') print(record.result ?? 'Task completed.');
      else if (record.status === 'waiting_for_input') print(`Input required: ${record.result ?? ''}`);
      else print(`Task ${record.status}: ${record.error ?? record.result ?? ''}`);
    }
  } finally {
    input.close();
  }
  print('CCPT session closed.');
}

function sessionMessageText(content: Awaited<ReturnType<typeof loadSession>>['messages'][number]['content']): string {
  if (typeof content === 'string') return content;
  return content.map((block) => {
    if (block.type === 'text') return block.text ?? '';
    if (block.type === 'thinking') return '[thinking retained; private reasoning hidden]';
    if (block.type === 'tool_use') return `[tool ${block.name ?? 'unknown'}] ${JSON.stringify(block.input ?? {})}`;
    if (block.type === 'tool_result') return `[tool result${block.is_error ? ' error' : ''}] ${block.content ?? ''}`;
    return JSON.stringify(block);
  }).join('\n');
}

async function printAgentLogs(id: string): Promise<void> {
  const agent = await loadAgent(id);
  const session = await loadSession(agent.sessionId);
  const messages = [...(session.archivedMessages ?? []), ...session.messages];
  print(`Agent ${agent.id} · ${agent.status} · ${agent.role}\n${agent.goal}\n\n${messages.map((message) => `${message.role.toUpperCase()}\n${sessionMessageText(message.content)}`).join('\n\n')}`);
}

async function attachAgent(id: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let previousText = '';
  let previousTurn = -1;
  let thinkingShown = false;
  let previousTool = '';
  while (true) {
    const agent = await loadAgent(id);
    const stream = agent.stream;
    if (stream && stream.turn !== previousTurn) {
      if (previousTurn >= 0 && previousText && !previousText.endsWith('\n')) process.stdout.write('\n');
      previousTurn = stream.turn;
      previousText = '';
      previousTool = '';
      thinkingShown = false;
    }
    if (stream?.thinking && !thinkingShown) {
      process.stdout.write('✻ Thinking…\n');
      thinkingShown = true;
    }
    if (stream?.text && stream.text.startsWith(previousText)) {
      const delta = stream.text.slice(previousText.length);
      if (delta) process.stdout.write(delta);
      previousText = stream.text;
    }
    const tool = stream?.activeTool?.name ?? '';
    if (tool && tool !== previousTool) process.stdout.write(`\n● ${tool}…\n`);
    previousTool = tool;
    if (!['queued', 'working'].includes(agent.status)) {
      if (previousText && !previousText.endsWith('\n')) process.stdout.write('\n');
      if (agent.status === 'completed' && agent.result && agent.result.trim() !== previousText.trim()) print(agent.result);
      else if (agent.status === 'waiting_for_input') print(`Input required: ${agent.result ?? ''}`);
      else if (agent.status !== 'completed') print(`Agent ${agent.status}: ${agent.error ?? agent.result ?? ''}`);
      return;
    }
    if (Date.now() - startedAt >= timeoutMs) throw new Error(`Attach timed out after ${timeoutMs}ms; the Agent is still ${agent.status}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
  }
}

async function main(): Promise<void> {
  const cwd = resolve(option('cwd', process.cwd()) ?? process.cwd());
  const firstArgument = args[0];
  if (rawArgs[0] === '--version' || firstArgument === 'version') { print(VERSION); return; }
  if (firstArgument === 'help' || flag('help')) { help(firstArgument === 'help' ? args[1] : flag('print') || rawArgs.includes('-p') ? 'print' : firstArgument); return; }
  if(firstArgument==='context-benchmark'){print((await import('./contextBenchmark.js')).benchmarkTextContext(Number(option('tokens','1000000')),option('encoding','cl100k_base') as import('./textTokenizer.js').TextEncoding));return;}
  if (option('state-home')) {
    if(firstArgument==='context-eval')throw new Error('--state-home is not a context-eval option');
    if (firstArgument !== '_automation_tick') throw new Error('--state-home is reserved for the owned scheduler tick');
    process.env.CCPT_HOME = resolve(option('state-home')!);
  }
  if (firstArgument === '_automation_tick') { const { tickAutomationScheduler } = await import('./automationScheduler.js'); print(await tickAutomationScheduler(args[1] ?? '')); return; }
  if(firstArgument==='audit-collector'){
    if(args[1]!=='serve'||!flag('confirm')||!option('collector-file'))throw new Error('Use audit-collector serve --collector-file CONFIG --port 8443 --confirm; administrator operation, foreground only');
    const allowed=new Set(['collector-file','port','host','confirm','cwd']);for(const k of Object.keys(parseCliInvocation(rawArgs).options))if(!allowed.has(k))throw new Error('Unsupported audit collector option');
    const host=option('host','127.0.0.1')!,port=Number(option('port','8443'));if(!['127.0.0.1','::1'].includes(host)||!Number.isSafeInteger(port)||port<0||port>65535)throw new Error('CLI collector binds loopback only, port 0–65535; expose TLS through an administrator-controlled deployment');
    const path=resolve(cwd,option('collector-file')!),s=await lstat(path);if(!s.isFile()||s.isSymbolicLink()||s.size>16000)throw new Error('Invalid collector configuration file');
    const text=await readFile(path,'utf8');if(Buffer.byteLength(text)>16000)throw new Error('Collector configuration grew beyond bounds');const {server,keyId}=await(await import('./auditCollectorServer.js')).createAuditCollectorServer(JSON.parse(text));
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.removeListener('error',reject);resolve()})});print({listening:server.address(),keyId,foreground:true,centralImmutableStorageVerified:false});
    await new Promise<void>(resolve=>{const stop=()=>{server.close(()=>resolve());server.closeAllConnections()},done=()=>{EventEmitter.prototype.removeListener.call(process,'SIGINT',stop);EventEmitter.prototype.removeListener.call(process,'SIGTERM',stop);resolve()};process.once('SIGINT',stop);process.once('SIGTERM',stop);server.once('close',done)});return;
  }
  if(firstArgument==='context-eval'){
    const allowed=new Set(['fixture','confirm','max-requests','max-tokens','cwd']);for(const name of Object.keys(parseCliInvocation(rawArgs).options))if(!allowed.has(name))throw new Error('Context eval uses reviewed persistent settings; unsupported temporary overrides are not ignored');
    if(!option('fixture'))throw new Error('Use context-eval --fixture FILE --confirm --max-requests N --max-tokens N');
    const config=await loadConfig(cwd),{withExecutionSignal}=await import('./executionControl.js'),controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
    try{const report=await withExecutionSignal(controller.signal,()=>(import('./contextQualityEval.js')).then(api=>api.runContextQualityEval(cwd,config,option('fixture')!,{confirmed:flag('confirm'),maxRequests:Number(option('max-requests')),maxTokens:Number(option('max-tokens'))})));print(report);process.exitCode=report.ok?0:1;}finally{EventEmitter.prototype.removeListener.call(process,'SIGINT',cancel);EventEmitter.prototype.removeListener.call(process,'SIGTERM',cancel);}return;
  }
  if(firstArgument==='_goal_worker'){await(await import('./goalWorkflow.js')).runGoalWorkflow(cwd,args[1]??'',Number(option('expected-version')));return;}
  if(firstArgument==='goal-run'){
    const api=await import('./goalWorkflow.js'),action=args[1],id=args[2],version=Number(option('expected-version'));
    const permitted=new Set(['cwd',...(action==='prepare'?['goal-id','plan-id','expected-plan-version','tools','max-requests','max-tokens','max-attempts','confirm']:['expected-version',...(action==='start'?['confirm','foreground']:action==='resume'?['confirm','feedback','approve-request','verified-unknown']:action==='cancel'?['confirm']:[])])]);
    for(const key of Object.keys(parseCliInvocation(rawArgs).options))if(!permitted.has(key))throw new Error(`goal-run does not accept --${key}; use reviewed persistent settings before preparing a bound workflow. No override was silently ignored.`);
    if(action==='list')print(await(await import('./goalManagement.js')).listGoalWorkflows(cwd));
    else if(action==='prepare'){
      if(!flag('confirm'))throw new Error('Goal workflow preparation requires explicit paid coding opt-in --confirm and an approved Plan');
      print(await api.prepareGoalWorkflow(cwd,{goalId:option('goal-id','')!,planId:option('plan-id','')!,expectedPlanVersion:Number(option('expected-plan-version')),maxRequests:Number(option('max-requests')),maxTokens:Number(option('max-tokens')),allowedTools:(option('tools','')!).split(',').filter(Boolean),maxAttempts:Number(option('max-attempts','3'))}));
    }else if(action==='show'&&id)print(await api.inspectGoalWorkflow(cwd,id));
    else if(action==='start'&&id){if(!flag('confirm'))throw new Error('Goal execution requires --confirm');print(flag('foreground')?await api.runGoalWorkflow(cwd,id,version):await api.launchGoalWorkflow(cwd,id,version,process.env.CCPT_CLI_ENTRY??process.argv[1]!));}
    else if(action==='resume'&&id){if(!flag('confirm'))throw new Error('Human continuation requires --confirm');print(await api.resumeGoalWorkflow(cwd,id,version,{...(option('feedback')?{feedback:option('feedback')!}:{}),...(option('approve-request')?{approveRequestId:option('approve-request')!}:{}),confirmUnknown:flag('verified-unknown')}));}
    else if(action==='recover'&&id)print(await api.recoverGoalWorkflow(cwd,id,version));
    else if(action==='cancel'&&id){if(!flag('confirm'))throw new Error('Goal cancellation requires --confirm');print(await api.cancelGoalWorkflow(cwd,id,version));}
    else throw new Error('Usage: goal-run prepare --goal-id ID --plan-id ID --expected-plan-version N --tools read_file,write_file,run_command --max-requests N --max-tokens N --confirm | show ID | start/resume/cancel ID --expected-version N --confirm | recover ID --expected-version N');
    return;
  }
  if(firstArgument==='plugin-set'){
    const allowed=new Set(['cwd','json','expected-version','expected-digest','confirm']);for(const name of Object.keys(parseCliInvocation(rawArgs).options))if(!allowed.has(name))throw new Error('Plugin-set requires reviewed persistent settings; temporary overrides are not accepted');
    const api=await import('./pluginSets.js');
    if(args[1]==='stage')print(await api.stagePluginSet(cwd,JSON.parse(option('json','[]')!),flag('confirm')));
    else if(args[1]==='stage-marketplace')print(await(await import('./marketplace.js')).stageMarketplacePluginSet(cwd,JSON.parse(option('json','[]')!),flag('confirm')));
    else if((args[1]==='activate'||args[1]==='rollback')&&args[2])print(await api.activatePluginSet(cwd,args[2],Number(option('expected-version')),flag('confirm')));
    else if(args[1]==='inspect')print(await api.inspectPluginSet(cwd,args[2]));
    else if(args[1]==='inventory')print(await api.inventoryPluginSets(cwd));
    else if(args[1]==='preview'&&args[2])print(await api.previewPluginSetActivation(cwd,args[2]));
    else if(args[1]==='apply'&&args[2])print(await api.activateReviewedPluginSet(cwd,args[2],option('expected-digest','')!,flag('confirm')));
    else if(args[1]==='recover'&&args[2])print(await api.recoverInterruptedPluginSet(cwd,args[2],option('expected-digest','')!,flag('confirm')));
    else if(args[1]==='migration-preview')print(await api.previewLegacyPluginMigration(cwd,JSON.parse(option('json','[]')!)));
    else if(args[1]==='migrate')print(await api.migrateLegacyPlugins(cwd,JSON.parse(option('json','[]')!),option('expected-digest','')!,flag('confirm')));
    else if(args[1]==='rollout-preview'&&args[2])print(await(await import('./pluginRollout.js')).previewPluginRollout(cwd,args[2]));
    else if(args[1]==='rollout-prepare'&&args[2])print(await(await import('./pluginRollout.js')).preparePluginRollout(cwd,args[2],option('expected-digest','')!,flag('confirm')));
    else if(args[1]==='rollout-apply'&&args[2])print(await(await import('./pluginRollout.js')).applyPluginRollout(cwd,args[2],Number(option('expected-version')),flag('confirm')));
    else if(args[1]==='rollout-reconcile'&&args[2])print(await(await import('./pluginRollout.js')).reconcilePluginRollout(cwd,args[2],Number(option('expected-version')),flag('confirm')));
    else if(args[1]==='rollouts')print(await(await import('./pluginRollout.js')).inspectPluginRollouts(cwd));
    else if(args[1]==='rollout-check')print(await(await import('./pluginRollout.js')).checkPluginRollouts(cwd));
    else if(args[1]==='health')print(await api.pluginSetHealth(cwd));
    else if(args[1]==='remediation-preview'&&args[2])print(await api.previewPluginSetRemediation(cwd,args[2]));
    else if(args[1]==='remediate'&&args[2])print(await api.remediatePluginSet(cwd,args[2],option('expected-digest','')!,flag('confirm')));
    else throw new Error('plugin-set stage|stage-marketplace --json LOCAL_PATH_OR_EXPLICIT_ID_ARRAY --confirm | inspect [ID] | activate/rollback ID --expected-version N --confirm');return;
  }
  if (firstArgument === 'extensions') {
    const { listGlobalExtensionTrust, setGlobalExtensionTrust } = await import('./globalExtensionTrust.js');
    if (args[1] === 'list') print(await listGlobalExtensionTrust());
    else if (['trust','untrust'].includes(args[1] ?? '') && args[2]) print(await setGlobalExtensionTrust(args[2], (option('kind', 'skill') ?? 'skill') as never, args[1] === 'trust', flag('confirm')));
    else throw new Error('Usage: extensions list|trust|untrust <absolute-directory> --kind skill|agent|plugin --confirm');
    return;
  }
  if (firstArgument === 'audit-checkpoint') {
    const mode=args[1];if(mode!=='publish'&&mode!=='query')throw new Error('Usage: audit-checkpoint publish|query --collector-file CONFIG_JSON --day YYYY-MM-DD --confirm');
    const path=resolve(cwd,option('collector-file','')!);if(!option('collector-file'))throw new Error('Explicit collector configuration file is required');
    const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>16000)throw new Error('Invalid collector configuration file');
    const text=await readFile(path,'utf8');if(Buffer.byteLength(text)>16000)throw new Error('Collector configuration exceeds limit');
    print(await(await import('./auditCheckpoint.js')).syncAuditCheckpoint(cwd,JSON.parse(text),option('day',new Date().toISOString().slice(0,10))!,mode,flag('confirm')));return;
  }
  if (firstArgument === 'event-outbox') {
    if (args[1] !== 'recover') throw new Error('Usage: event-outbox recover --cwd PROJECT (metadata delivery only; no business retries)');
    print(await (await import('./projectOutbox.js')).recoverProjectOutboxes(cwd)); return;
  }
  if (firstArgument === 'notifications') {
    const center = await import('./notifications.js');
    if (!args[1] || args[1] === 'list') print(await center.listProjectNotifications(cwd,{offset:Number(option('offset','0')),limit:Number(option('limit','50')),unreadOnly:flag('unread')}));
    else if (args[1] === 'read' && args[2]) {
      if (!flag('confirm')) throw new Error('Notification acknowledgement requires --confirm');
      print(await center.markProjectNotificationsRead(cwd,[args[2]],option('expected-version','')!));
    } else throw new Error('Usage: notifications list | read ID --expected-version <version> --confirm');
    return;
  }
  const tokenLimits: Partial<Pick<PlatformConfig['model'], 'maxContextTokens' | 'maxOutputTokens'>> = {};
  for (const [name, field] of [['max-context', 'maxContextTokens'], ['max-output', 'maxOutputTokens']] as const) {
    if (!flag(name)) continue;
    const value = option(name);
    if (value === undefined || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error(`--${name} requires a positive whole number`);
    tokenLimits[field] = Number(value);
  }
  setSessionTokenLimits(tokenLimits);
  const { cliSessionOverrides } = await import('./runtimeOptions.js');
  let runtimeOverrides = await cliSessionOverrides(rawArgs, cwd, !(firstArgument === 'config' && args[1] === 'set'));
  if (firstArgument === 'model' && ['test', 'acceptance','enterprise-acceptance'].includes(args[1] ?? '')) {
    const { modelProbeOverrides } = await import('./modelProbe.js');
    runtimeOverrides = { ...runtimeOverrides, ...modelProbeOverrides(rawArgs, runtimeOverrides.model) };
  }
  setSessionOverrides(runtimeOverrides, flag('strict-mcp-config'));
  const backgroundShortcut = rawArgs[0] === '--bg';
  const printMode = flag('print') || rawArgs.includes('-p');
  if (flag('no-session-persistence') && !printMode) throw new Error('--no-session-persistence is available only with --print');
  const command = printMode ? 'print' : backgroundShortcut ? 'run' : firstArgument?.startsWith('--') ? undefined : firstArgument;
  if ((flag('resume') || flag('continue') || flag('fork-session')) && command && command !== 'print') throw new Error('Session startup options apply to interactive mode or --print');
  const resumeReference = flag('resume') && option('resume') && !option('resume')!.startsWith('-') ? option('resume') : undefined;
  let picker = flag('resume') && resumeReference === undefined;
  let pickerQuery: string | undefined;
  if (picker && flag('continue')) throw new Error('--resume and --continue cannot be combined');
  if (picker && printMode) throw new Error('--print --resume requires a session ID or name; the picker is interactive only');
  if (flag('no-session-persistence') && (flag('resume') || flag('continue') || flag('fork-session'))) throw new Error('--no-session-persistence cannot resume, continue or fork sessions');
  let resumeId: string | undefined;
  const allowActiveResume = Boolean(process.stdin.isTTY && process.stdout.isTTY && !printMode && !flag('fork-session') && !Object.keys(runtimeOverrides).length && !Object.keys(tokenLimits).length && !flag('restricted') && !flag('permission-mode'));
  try { resumeId = await startupSession(cwd, resumeReference, flag('continue'), { allowActive: allowActiveResume }); }
  catch (error) {
    if (!(error instanceof AmbiguousSessionNameError) || printMode || command) throw error;
    picker = true; pickerQuery = error.query;
  }
  if (flag('fork-session') && !resumeId && !picker) throw new Error('--fork-session requires --resume or --continue');
  if (!command) {
    const preferences = { allowActive: allowActiveResume, modelOverride: flag('model'), effortOverride: flag('effort') };
    await interactive(cwd, picker ? { picker: true, ...(pickerQuery !== undefined ? { query: pickerQuery } : {}), fork: flag('fork-session'), ...preferences } : resumeId ? { sessionId: resumeId, fork: flag('fork-session'), ...preferences } : undefined); return;
  }
  if (command === '_worker') { const id = args[1]; if (!id) throw new Error('Worker id required'); await runAgentWorker(id); return; }
  if (command === '_shell_worker') { const id = args[1]; if (!id) throw new Error('Shell worker id required'); await runShellTaskWorker(id); return; }
  if (command === 'init') { await init(cwd); return; }
  if (command === 'model') {
    if (!['test', 'acceptance','enterprise-acceptance'].includes(args[1] ?? '')) throw new Error('Usage: ccpt model test|acceptance|enterprise-acceptance --help');
    const config = await loadConfig(cwd);
    validateConfig(config);
    const { probeModel, probeModelAcceptance } = await import('./modelProbe.js');
    if(args[1]==='enterprise-acceptance'){
      const {withExecutionSignal}=await import('./executionControl.js'),controller=new AbortController(),stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
      try{const result=await withExecutionSignal(controller.signal,()=>(import('./enterpriseAcceptance.js')).then(api=>api.runEnterpriseAcceptance(cwd,config,{confirmed:flag('confirm'),maxRequests:Number(option('max-requests')),maxTokens:Number(option('max-tokens')),timeoutMs:Number(option('timeout','20000'))})));print(result);process.exitCode=result.ok?0:1;}finally{EventEmitter.prototype.removeListener.call(process,'SIGINT',stop);EventEmitter.prototype.removeListener.call(process,'SIGTERM',stop);}return;
    }
    if (args[1] === 'acceptance') {
      const { withExecutionSignal } = await import('./executionControl.js');
      const controller = new AbortController(), stop = () => controller.abort();
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      try { const result = await withExecutionSignal(controller.signal, () => probeModelAcceptance(config, flag('confirm'), { diagnostics: flag('diagnostics'), timeoutMs: Number(option('timeout', '20000')) })); print(result); process.exitCode = result.ok ? 0 : 1; }
      finally { EventEmitter.prototype.removeListener.call(process, 'SIGINT', stop); EventEmitter.prototype.removeListener.call(process, 'SIGTERM', stop); }
      return;
    }
    const result = await probeModel(config, { connectivityOnly: flag('connectivity-only'), stream: flag('stream'), toolsCheck: flag('tools-check'), fullToolsCheck: flag('full-tools-check'), diagnostics: flag('diagnostics'), timeoutMs: Number(option('timeout', '20000')) });
    print(result); process.exitCode = result.ok ? 0 : 1; return;
  }
  if (command === 'mcp' && args[1] === 'watch') {
    if((flag('interactive-url')||flag('interactive-tools')||flag('interactive-audio'))&&!flag('interactive'))throw new Error('--interactive-url/--interactive-tools/--interactive-audio also requires --interactive');
    if (!args[2]) throw new Error('Usage: ccpt mcp watch <name> [--timeout 60000] [--max-events 1000] [--max-reconnects 5]');
    const config = await loadConfig(cwd);
    const { watchMcpServer } = await import('./mcp.js');
    const controller = new AbortController();
    const stop = (): void => { controller.abort(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    try {
      const result = await watchMcpServer(args[2], config, {
        ...(flag('interactive') ? {interactions:(await import('./mcpInteractiveCli.js')).createInteractiveMcpHandlers(args[2],config,{url:flag('interactive-url'),tools:flag('interactive-tools'),audio:flag('interactive-audio')})} : {}),
        maxInteractions:Number(option('max-interactions','8')),
        durationMs: Number(option('timeout', '60000')), maxEvents: Number(option('max-events', '1000')), maxReconnects: Number(option('max-reconnects', '5')), signal: controller.signal,
        onNotification: notification => { process.stdout.write(`${JSON.stringify({ type: 'mcp_notification', server: args[2], notification: configForDisplay(notification) })}\n`); },
        onStatus: status => { process.stderr.write(`${JSON.stringify({ type: 'mcp_watch_status', ...status })}\n`); },
      });
      process.stdout.write(`${JSON.stringify({ type: 'mcp_watch_result', ...result })}\n`);
    } finally { EventEmitter.prototype.removeListener.call(process, 'SIGINT', stop); EventEmitter.prototype.removeListener.call(process, 'SIGTERM', stop); }
    return;
  }
  const platform = await loadPlatform(cwd);
  const config = platform.config;
  validateConfig(config);

  if (command === 'print') {
    if (backgroundShortcut || flag('background') || flag('bg')) throw new Error('--print is a foreground operation; use run --background separately');
    const format = option('output-format', 'text') as PrintFormat;
    if (!['text', 'json', 'stream-json'].includes(format)) throw new Error('--output-format must be text, json or stream-json');
    const inputFormat = option('input-format', 'text');
    if (!['text', 'stream-json'].includes(inputFormat!)) throw new Error('--input-format must be text or stream-json');
    if (inputFormat === 'stream-json' && (format !== 'stream-json' || args.length)) throw new Error('Stream input requires --output-format stream-json and no positional prompt');
    if (flag('no-session-persistence') && (flag('resume') || flag('fork-session') || flag('worktree'))) throw new Error('--no-session-persistence cannot resume/fork persisted sessions or create worktrees');
    const prompt = inputFormat === 'stream-json' ? '' : args.join(' ').trim() || await readPrintInput();
    if (inputFormat === 'text' && !prompt) throw new Error('A non-empty print prompt is required');
    const promptFile = option('append-system-prompt-file');
    const instructions = [option('append-system-prompt'), promptFile ? await readFile(resolve(cwd, promptFile), 'utf8') : ''].filter(Boolean).join('\n\n');
    const resume = resumeId;
    const execute = async (runtimeConfig: PlatformConfig): Promise<number> => {
      const options = { prompt, cwd, config: runtimeConfig, format, ...(option('agent') ? { role: option('agent')! } : {}), ...(resume ? { resume } : {}), fork: flag('fork-session'), worktree: flag('worktree'), ...(instructions ? { instructions } : {}) };
      return inputFormat === 'stream-json' ? (await import('./streamInput.js')).runPrintStream(options) : runPrint(options);
    };
    process.exitCode = flag('no-session-persistence') ? await (await import('./ephemeralSession.js')).withEphemeralSession(config, execute) : await execute(config);
    return;
  }

  if (command === 'budget' && args[1]) {
    const { readSpending } = await import('./spending.js');
    print(await readSpending(args[1])); return;
  }
  if (command === 'credentials') {
    if (args[1] === 'list') print({ backend: config.model.credentialBackend??'windows-dpapi', names: await listModelCredentials(config.model) });
    else if (args[1] === 'set' && args[2]) {
      const envName = option('from-env');
      if (flag('stdin') && envName !== undefined) throw new Error('Choose --stdin or --from-env, not both');
      if (!flag('stdin') && (!envName || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName) || !process.env[envName])) throw new Error('Use credentials set NAME --stdin or --from-env ENV_NAME; the key must not be passed as an argument');
      const key = flag('stdin') ? await (await import('./credentialInput.js')).readCredentialInput() : process.env[envName!]!;
      await storeModelCredential(args[2], key, config.model);
      print({ stored: args[2], backend: config.model.credentialBackend??'windows-dpapi', endpointBound: true, settingsChanged: false });
    } else if (args[1] === 'remove' && args[2]) { await removeModelCredential(args[2],config.model); print({ removed: args[2] }); }
    else throw new Error('Usage: credentials <list|set NAME (--stdin|--from-env ENV_NAME)|remove NAME>');
    return;
  }

  if (command === 'run') {
    const goal = (backgroundShortcut ? args : positional(1)).join(' ');
    if (!goal) throw new Error('A goal is required');
    const isolation = flag('no-worktree') ? 'none' : flag('worktree') ? 'worktree' : config.agents.defaultIsolation;
    const role = option('agent', 'lead') ?? 'lead';
    const record = await spawnAgent({ goal, cwd, config, role, isolation, background: backgroundShortcut || flag('background') || flag('bg') });
    print(record);
    return;
  }
  if (command === 'agents') {
    if (!args[1]) {
      print((await listAgents()).map(({ id, role, status, goal, updatedAt, pid, result, error }) => ({ id, role, status, goal, updatedAt, pid, summary: result ?? error })));
    } else if (args[1] === 'recovery-list') print(await listWorktreeRecoveries(cwd, config));
    else if (args[1] === 'recovery-page') print(await recoveryPage(cwd, config, Number(option('offset', '0')), Number(option('limit', '50'))));
    else if(args[1]==='recovery-maintenance'){const api=await import('./recoveryMaintenance.js');print(args[2]==='run'?await api.runRecoveryMaintenance(cwd,option('expected-digest','')!,flag('confirm'),config):await api.planRecoveryMaintenance(cwd,config));}
    else if(args[1]==='recovery-remote'){const api=await import('./recoveryMaintenance.js');if(args[2]==='prepare')print(await api.prepareRecoveryRemote(cwd,flag('confirm'),config));else if(args[2]==='run'&&args[3])print(await api.runRecoveryRemote(cwd,args[3],option('expected-digest','')!,flag('confirm'),config));else if(args[2]==='query'&&args[3])print(await api.queryRecoveryRemote(cwd,args[3],flag('confirm'),config));else throw new Error('agents recovery-remote prepare --confirm | run ID --expected-digest DIGEST --confirm | query ID --confirm');}
    else if (args[1] === 'recovery-backup') print(await createRecoveryBackup(cwd, config, flag('confirm')));
    else if (args[1] === 'recovery-backup-check' && args[2]) print(await inspectRecoveryBackup(cwd, args[2], option('expected-sha256', '')!, config));
    else if (args[1] === 'recovery-import' && args[2]) print(await importRecoveryBackup({ repo: cwd, directory: args[2], expectedSha256: option('expected-sha256', '')!, ref: option('ref', '')!, branch: option('branch', '')!, confirmed: flag('confirm') }, config));
    else if (args[1] === 'recovery-prune' && args[2]) { await pruneWorktreeRecovery(cwd, args[2], option('expected-commit', '')!, flag('confirm'), config); print('Removed the reviewed recovery ref; its commit remains retained by a branch/tag.'); }
    else if (args[1] === 'conflict-guide' && args[2]) print(await conflictGuide(cwd, args[2], config));
    else if (args[1] === 'conflict-versions' && args[2]) print(await conflictVersions(cwd, args[2], config));
    else if(args[1]==='conflict-review'&&args[2])print(await(await import('./worktree.js')).reviewBinaryConflict(cwd,args[2],config));
    else if(args[1]==='conflict-resolve'&&args[2])print(await(await import('./conflictResolution.js')).resolveConflict(cwd,args[2],option('choice') as import('./conflictResolution.js').ConflictChoice,option('expected-version','')!,flag('confirm'),config));
    else if(args[1]==='conflict-restore-preview'&&args[2])print(await(await import('./conflictRestore.js')).previewConflictRestore(cwd,args[2],config));
    else if(args[1]==='conflict-restore'&&args[2])print(await(await import('./conflictRestore.js')).restoreConflictResolution(cwd,args[2],option('expected-digest','')!,flag('confirm'),config));
    else if(args[1]==='conflict-stage-binary'&&args[2])print(await(await import('./worktree.js')).stageReviewedBinaryConflict(cwd,args[2],option('expected-version','')!,flag('confirm'),config));
    else if (args[1] === 'conflict-stage' && args[2]) { await stageResolvedConflict(cwd, args[2], option('expected-version', '')!, flag('confirm'), config); print('Staged the manually reviewed resolution. No commit or push performed.'); }
    else if (args[1] === 'conflicts') print(await inspectGitConflicts(cwd, config));
    else if (args[1] === 'recover' && args[2] && args[3]) { if (!flag('confirm')) throw new Error('Local recovery branch creation requires --confirm'); print(await restoreWorktreeRecovery(cwd, args[2], args[3], config)); }
    else if (args[1] === 'wait' && args[2]) print(await waitForAgent(args[2], Number(option('timeout', '600000'))));
    else if (args[1] === 'attach' && args[2]) await attachAgent(args[2], Number(option('timeout', '600000')));
    else if (args[1] === 'logs' && args[2]) await printAgentLogs(args[2]);
    else if (args[1] === 'stop' && args[2]) print(await cancelAgent(args[2]));
    else if (args[1] === 'cancel' && args[2]) print(await cancelAgent(args[2]));
    else if (args[1] === 'cleanup' && args[2]) {
      const agent = await loadAgent(args[2]);
      if (['queued', 'working', 'waiting_for_input'].includes(agent.status)) throw new Error('Stop or finish the Agent before removing its worktree');
      if (!agent.worktree) throw new Error(`Agent ${agent.id} has no worktree`);
      if (flag('merge')) await mergeWorktree(agent.cwd, agent.worktree, agent.id, config);
      else await removeWorktree(agent.cwd, agent.worktree, config);
      delete agent.worktree;
      await saveAgent(agent);
      print(agent);
    }
    else print(await loadAgent(args[1]));
    return;
  }
  if (command === 'attach' && args[1]) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      const owner = await loadAgent(args[1]);
      const sameDirectory = process.platform === 'win32' ? resolve(owner.cwd).toLowerCase() === resolve(cwd).toLowerCase() : resolve(owner.cwd) === resolve(cwd);
      if (!sameDirectory) throw new Error('Agent belongs to another workspace; set --cwd to its original directory before attaching');
      await interactive(cwd, { sessionId: owner.sessionId, fork: false, allowActive: allowActiveResume, modelOverride: flag('model'), effortOverride: flag('effort') });
    } else await attachAgent(args[1], Number(option('timeout', '600000')));
    return;
  }
  if (command === 'logs' && args[1]) { await printAgentLogs(args[1]); return; }
  if (command === 'stop' && args[1]) { print(await cancelAgent(args[1])); return; }
  if (command === 'plan') {
    const action = args[1] ?? 'list';
    if (action === 'list') {
      print((await listPlanRecords(cwd)).map(({ id, version, status, title, updatedAt, executionAgentId }) => ({ id, version, status, title, updatedAt, executionAgentId })));
    } else if (action === 'show' && args[2]) print(await loadProjectPlan(cwd, args[2]));
    else if (action === 'recover' && args[2]) print(await recoverProjectPlanExecution(cwd, args[2]));
    else if (action === 'approve' && args[2]) {
      const version = option('expected-version');
      if (version !== undefined && (!Number.isSafeInteger(Number(version)) || Number(version) < 1)) throw new Error('--expected-version must be a positive integer');
      const approved = await transitionProjectPlan(cwd, args[2], 'approved', { ...(version ? { expectedVersion: Number(version) } : {}), comment: positional(3).join(' ') });
      print(flag('execute') ? await executeProjectPlan({ cwd, planId: approved.id, background: !flag('foreground') }) : approved);
    } else if (action === 'changes' && args[2]) print(await transitionProjectPlan(cwd, args[2], 'changes_requested', { comment: positional(3).join(' ') || 'Changes requested' }));
    else if (action === 'reject' && args[2]) print(await transitionProjectPlan(cwd, args[2], 'rejected', { comment: positional(3).join(' ') || 'Rejected' }));
    else if (action === 'cancel' && args[2]) print(await transitionProjectPlan(cwd, args[2], 'cancelled', { comment: positional(3).join(' ') }));
    else if (action === 'execute' && args[2]) print(await executeProjectPlan({ cwd, planId: args[2], background: !flag('foreground') }));
    else if (action === 'step' && args[2] && args[3] && args[4]) print(await updateProjectPlanStep(cwd, args[2], args[3], args[4] as Parameters<typeof updateProjectPlanStep>[3], positional(5).join(' ')));
    else throw new Error('Usage: plan <list|show ID|recover ID|approve ID [comment] [--execute]|changes ID comment|reject ID [comment]|cancel ID|execute ID [--foreground]|step ID STEP_ID STATUS [note]>');
    return;
  }
  if (command === 'tasks') {
    if (args[1] === 'show' && args[2]) print(await loadTask(args[2]));
    else if (args[1] === 'claim' && args[2] && args[3]) {
      const task = await loadTask(args[2]);
      print(await claimTask(task.id, task.teamSessionId, args[3]));
    }
    else print(await listTasks());
    return;
  }
  if (command === 'insights' || command === 'usage') { print(await usageInsights(args[1] ? { sessionId: args[1] } : {})); return; }
  if (command === 'artifacts') { print(await listArtifacts(cwd)); return; }
  if (command === 'channels') { print(await listChannels(cwd)); return; }
  if (command === 'routines') { print({ routines: await listRoutines(cwd), runs: await listRoutineRuns(cwd) }); return; }
  if (command === 'shell') {
    const action = args[1];
    if (action === 'start' && args[2]) print(await startShellTask({ command: args[2], args: positional(3), cwd, config, actor: 'cli' }));
    else if (action === 'output' && args[2]) print(await getShellTaskOutput(args[2], Number(option('max-chars', '100000'))));
    else if (action === 'stop' && args[2]) print(await stopShellTask(args[2]));
    else throw new Error('Usage: shell <start <command> [args...]|output <task-id>|stop <task-id>>');
    return;
  }
  if (command === 'team') {
    const teamSessionId = args[1];
    const action = args[2] ?? 'members';
    if (!teamSessionId) throw new Error('Usage: team <team-session-id> <members|inbox|send> ...');
    if (action === 'members') print(await discoverTeam(teamSessionId));
    else if (action === 'inbox' && args[3]) print(await readTeamMailbox({ teamSessionId, agentId: args[3], unreadOnly: !flag('all'), markRead: !flag('keep-unread') }));
    else if (action === 'send' && args[3] && args[4]) print(await sendTeamMessage({ teamSessionId, fromAgentId: args[3], toAgentId: args[4], content: args.slice(5).join(' ') }));
    else throw new Error('Usage: team <team-session-id> <members|inbox <agent-id>|send <from-agent-id> <to-agent-id> <message>>');
    return;
  }
  if (command === 'checkpoint') {
    const action = args[1] ?? 'list';
    if (action === 'list') {
      print((await listCheckpoints(cwd)).map(({ id, reason, createdAt, sessionId, entries }) => ({ id, reason, createdAt, sessionId, files: entries.length })));
    } else if (action === 'create') {
      const files = positional(2).map((path) => resolve(cwd, path));
      print(await createCheckpoint({ cwd, config, ...(files.length ? { files } : {}), reason: 'Manual CLI checkpoint' }));
    } else if (action === 'restore') {
      const id = args[2]?.startsWith('--') ? undefined : args[2];
      print(await restoreCheckpoint({ cwd, config, ...(id ? { id } : {}), restoreCode: !flag('conversation-only'), restoreConversation: flag('conversation') || flag('conversation-only') }));
    } else throw new Error('Usage: checkpoint <create|list|restore> [id|files...] [--conversation|--conversation-only]');
    return;
  }
  if (command === 'workflow' && args[1] === 'run' && args[2]) {
    const results = await runWorkflow(await loadWorkflow(resolve(cwd, args[2])), cwd, config);
    print(Object.fromEntries(results));
    return;
  }
  if (command === 'sessions') {
    if (args[1] === 'show' && args[2]) print(await loadSession(args[2]));
    else if (args[1] === 'preview' && args[2]) print(await (await import('./sessionHistoryView.js')).sessionHistory(cwd, args[2], { includeText: flag('include-text'), limit: Number(option('limit', '50')), textLimit:Number(option('text-limit','2000')), ...(option('cursor') ? { cursor: option('cursor')! } : {}) }));
    else if (args[1] === 'activity' && args[2]) print(await (await import('./runtimeHistory.js')).runtimeHistory(cwd, args[2], option('cursor'), Number(option('limit', '100')),{includeText:flag('include-text')}));
    else if(args[1]==='replay'&&args[2])print(await(await import('./runtimeReplay.js')).runtimeReplay(cwd,args[2],option('cursor'),Number(option('limit','100')),flag('include-text')));
    else if (args[1] === 'context' && args[2]) {
      const session = await loadSession(args[2]);
      if (session.compaction) print({ compaction: session.compaction });
      print(session.contextSnapshot ? formatContextSnapshot(session.contextSnapshot) : 'Full request breakdown unavailable until the next model request.');
    }
    else if (args[1] === 'compact' && args[2]) {
      await assertSessionIdle(args[2]);
      const session = await loadSession(args[2]);
      const sessionConfig = await loadConfig(session.cwd);
      const before = session.messages.length;
      compactSession(session, sessionConfig.model.maxContextTokens, { force: true, model:sessionConfig.model });
      await saveSession(session);
      print({ sessionId: session.id, before, after: session.messages.length, archived: session.archivedMessages?.length ?? 0, note: 'Full history retained; latest user turn and tool results stay together. Summary contains extractive excerpts.' });
    }
    else if (args[1] === 'export') {
      if (!args[2] || !args[3]) throw new Error('Usage: ccpt sessions export <id> <path.md|path.json>');
      print(await exportSession(await loadSession(args[2]), args[3], cwd, config));
    }
    else if (args[1] === 'history' && args[2]) print(args[3] ? await fetchOlderEvents(args[2], args[3], Number(option('limit', '100'))) : await fetchLatestEvents(args[2], Number(option('limit', '100'))));
    else if (args[1] === 'fork' && args[2]) print(await forkSession(args[2], option('title')));
    else if (args[1] === 'resume' && args[2]) {
      const session = await loadSession(args[2]);
      const goal = args.slice(3).join(' ') || 'Continue the previous task from the saved context.';
      print(await spawnAgent({ goal, cwd: session.cwd, config: (await loadPlatform(session.cwd)).config, sessionId: session.id, isolation: flag('worktree') ? 'worktree' : 'none', background: flag('background') }));
    }
    else print((await listSessions()).map(({ id, parentId, title, cwd: sessionCwd, updatedAt }) => ({ id, parentId, title, cwd: sessionCwd, updatedAt })));
    return;
  }
  if (command === 'memory') {
    const action = args[1] ?? 'list'; const scope = args[2] ?? 'project';
    if (action === 'list') print(await listMemory(scope));
    else if (action === 'get' && args[3]) print(await getMemory(scope, args[3]));
    else if (action === 'set' && args[3]) { await setMemory(scope, args[3], args.slice(4).join(' ')); print('stored'); }
    else throw new Error('Usage: memory <list|get|set> [scope] [key] [value]');
    return;
  }
  if (command === 'platform') {
    const action = args[1] ?? 'inspect';
    if (action === 'init') print(await initializePlatform(cwd));
    else if (action === 'guide') print(platformGuide);
    else if (action === 'inspect') print({
      plugins: platform.plugins.map(({ name, version, path }) => ({ name, version, path })),
      skills: platform.skills.map(({ name, description, source, path }) => ({ name, description, source, path })),
      agents: platform.agents.map(({ name, description, source, path }) => ({ name, description, source, path })),
      commands: platform.commands.map(({ name, description, plugin }) => ({ name, description, plugin })),
      mcpServers: Object.keys(config.mcpServers),
      lspServers: Object.keys(config.lspServers),
      hooks: config.hooks.length,
      diagnostics: platform.diagnostics,
    });
    else throw new Error('Usage: platform <init|inspect|guide>');
    return;
  }
  if (command === 'surface') {
    const registry = await loadSurfaceRegistry(cwd, config, option('surface-manifest'));
    const action = args[1] ?? 'list';
    if (action === 'list') print(registry.list());
    else if (action === 'health') print(await surfaceHealth(registry, args[2]));
    else if (action === 'invoke' && args[2] && args[3]) print(await registry.invoke(args[2], args[3], JSON.parse(option('json', '{}') ?? '{}')));
    else throw new Error('Usage: surface <list|health [name]|invoke <name> <action> [--json input]>');
    return;
  }
  if (command === 'teams') {
    const action = args[1] ?? 'list';
    if (action === 'list') print((await listTeams()).filter((team) => resolve(team.cwd ?? '') === cwd));
    else if (action === 'cleanup' && args[2] && args[3] === 'confirm') {
      const team = await loadTeam(args[2]); if (!team.cwd || resolve(team.cwd) !== cwd) throw new Error('Team is outside this workspace'); await deleteTeam(team.id); print({ removed: team.id, retained: 'Agent sessions, tasks, files and worktrees' });
    } else if (args[2]) {
      const agent = await loadAgent(args[2]); if (resolve(agent.cwd) !== cwd) throw new Error('Agent is outside this workspace'); const teamSessionId = agent.teamSessionId ?? agent.sessionId;
      if (action === 'create') print(await createTeam(positional(3).join(' '), agent.id));
      else if (action === 'members') print(await discoverTeam(teamSessionId));
      else if (action === 'inbox') print(await readTeamMailbox({ teamSessionId, agentId: agent.id, unreadOnly: false, markRead: false }));
      else if (action === 'send' && args[3]) print(await sendTeamMessage({ teamSessionId, fromAgentId: agent.id, toAgentId: args[3], content: positional(4).join(' ') }));
      else if (action === 'broadcast') print(await broadcastTeamMessage({ teamSessionId, fromAgentId: agent.id, content: positional(3).join(' ') }));
      else if (action === 'shutdown' && args[3]) print(await requestTeamShutdown({ teamSessionId, fromAgentId: agent.id, toAgentId: args[3] }));
      else throw new Error('Use teams --help for lifecycle commands');
    } else throw new Error('Use teams --help for lifecycle commands');
    return;
  }
  if (command === 'skill' || command === 'skills') {
    const action = args[1] ?? 'list';
    if (action === 'create' && args[2]) print(await createSkillScaffold(cwd, args[2]));
    else if (action === 'show' && args[2]) print(platform.skills.find((skill) => skill.name === args[2]) ?? { error: 'not found' });
    else if (action === 'run' && args[2]) {
      const agentId = option('agent-id'); if (agentId && resolve((await loadAgent(agentId)).cwd) !== cwd) throw new Error('Agent is outside this workspace');
      print(await invokeUserSkill({ name: args[2], args: positional(3).join(' '), cwd, config, background: flag('background'), ...(agentId ? { agentId } : {}) }));
    }
    else if (action === 'visibility' && args[2] && args[3]) {
      const visibility = args[3]; if (!['on', 'name-only', 'user-invocable-only', 'off'].includes(visibility)) throw new Error('Invalid Skill visibility');
      const skill = platform.availableSkills?.find((item) => item.name.toLowerCase() === args[2]!.toLowerCase()); if (!skill) throw new Error('Unknown Skill');
      const path = join(projectStateDir(cwd), 'settings.json'); const settings = await readJson<PlatformConfig>(path, config);
      const overrides = { ...settings.skillOverrides }; const aliases = (platform.availableSkills ?? []).filter((item) => item.path === skill.path).map((item) => item.name.toLowerCase());
      for (const key of Object.keys(overrides)) if (aliases.includes(key.toLowerCase())) delete overrides[key]; overrides[skill.name] = visibility as import('./skills.js').SkillVisibility;
      await writeJson(path, { ...settings, skillOverrides: overrides });
      const effective = await loadPlatform(cwd); print({ name: skill.name, requested: visibility, effective: effective.availableSkills?.find((item) => item.name === skill.name)?.visibility });
    }
    else if (action === 'mode' && args[2] && args[3]) {
      const mode = args[3];
      if (!['auto', 'manual', 'disabled'].includes(mode)) throw new Error('Skill mode must be auto, manual, or disabled');
      const skill = platform.availableSkills?.find((item) => item.name.toLowerCase() === args[2]!.toLowerCase());
      if (!skill) throw new Error('Unknown skill; run skill list first');
      const path = join(projectStateDir(cwd), 'settings.json');
      const settings = await readJson<Record<string, unknown>>(path, {});
      const modes = { ...(settings.skillModes as PlatformConfig['skillModes']) };
      const aliases = (platform.availableSkills ?? []).filter((item) => item.path === skill.path).map((item) => item.name.toLowerCase());
      for (const name of Object.keys(modes)) if (aliases.includes(name.toLowerCase())) delete modes[name];
      modes[skill.name] = mode as 'auto' | 'manual' | 'disabled';
      const disabledSkills = (Array.isArray(settings.disabledSkills) ? settings.disabledSkills : []).filter((name: unknown) => typeof name === 'string' && !aliases.includes(name.toLowerCase()));
      await writeJson(path, { ...settings, skillModes: modes, disabledSkills });
      const effective = await loadPlatform(cwd);
      print({ name: skill.name, requested: mode, effective: effective.availableSkills?.find((item) => item.name === skill.name)?.mode });
    }
    else if (action === 'list') print((platform.availableSkills ?? platform.skills).map(({ name, description, source, path, mode, visibility, userInvocable, context, argumentHint }) => ({ name, description, source, path, mode, visibility, userInvocable, context, argumentHint })));
    else throw new Error('Use skill --help for create, list, show, run, mode and visibility commands');
    return;
  }
  if (command === 'agent') {
    const action = args[1] ?? 'list';
    if (action === 'create' && args[2]) print(await createAgentScaffold(cwd, args[2]));
    else if (action === 'show' && args[2]) print(platform.agents.find((agent) => agent.name === args[2]) ?? { error: 'not found' });
    else if (action === 'list') print(platform.agents.map(({ name, description, source, path }) => ({ name, description, source, path })));
    else if (action === 'run' && args[2]) {
      const profile = platform.agents.find((agent) => agent.name === args[2]);
      if (!profile) throw new Error(`Unknown Agent definition: ${args[2]}`);
      const goal = args.slice(3).join(' ');
      if (!goal) throw new Error('Agent goal is required');
      print(await spawnAgent({ goal, cwd, config, role: profile.name, ...(profile.isolation ? { isolation: profile.isolation } : {}), background: Boolean(flag('background') || profile.background) }));
    } else throw new Error('Usage: agent <create|list|show|run> [name] [goal]');
    return;
  }
  if (command === 'plugin') {
    if (args[1] === 'sources') { print(await inspectMarketplaceInstallations(cwd)); return; }
    if (args[1] === 'repair-source' && args[2]) { const scope = option('scope', 'project'); if (scope !== 'project' && scope !== 'local') throw new Error('--scope must be project or local'); print(await repairMarketplaceReceipt(cwd, args[2], flag('confirm'), scope)); return; }
    if (args[1] === 'orphans') { print(await listPluginOrphans(cwd)); return; }
    if (args[1] === 'quarantine' && args[2]) { print(await quarantinePluginOrphan(cwd, args[2], option('expected-digest', '')!, flag('confirm'))); return; }
    if (args[1] === 'transactions') { print(await listInterruptedPluginTransactions(cwd)); return; }
    if (args[1] === 'recover' && args[2]) { print(await recoverPluginTransaction(cwd, args[2], flag('confirm'))); return; }
    const action = args[1] ?? 'list';
    if (action === 'create' && args[2]) print(await createPluginScaffold(cwd, args[2]));
    else if (action === 'show' && args[2]) print(platform.plugins.find((plugin) => plugin.name === args[2]) ?? { error: 'not found' });
    else if (action === 'validate' && args[2]) print(await validatePlugin(resolve(cwd, args[2])));
    else if (['history', 'snapshot', 'rollback'].includes(action) && args[2]) {
      const scope = option('scope', 'project'); if (scope !== 'project' && scope !== 'local') throw new Error('--scope must be project or local');
      if (action === 'history') print(await listPluginHistory(cwd, args[2], scope));
      else if (action === 'snapshot') print(await snapshotPlugin(cwd, args[2], scope));
      else { if (!args[3] || !flag('confirm')) throw new Error('Usage: plugin rollback <name> <revision_ID> --confirm [--scope project|local]'); print(await rollbackPlugin(cwd, args[2], args[3], scope)); }
    }
    else if (action === 'hash' && args[2]) print({ algorithm: 'sha256', digest: await computePluginDigest(resolve(cwd, args[2])) });
    else if (action === 'sign' && args[2]) {
      const keyFile = option('key-file'), keyId = option('key-id');
      if (!keyFile || !keyId) throw new Error('Usage: plugin sign <path> --key-file <private.pem> --key-id <publisher>');
      const { signPlugin } = await import('./pluginSignatures.js');
      print(await signPlugin(resolve(cwd, args[2]), resolve(cwd, keyFile), keyId));
    }
    else if(action==='overlay-sign'&&args[2]){
      const keyFile=option('key-file'),keyId=option('key-id');if(!keyFile||!keyId||!option('json'))throw new Error('Use plugin overlay-sign PATH --json CONTRIBUTIONS --key-file PRIVATE_PEM --key-id PUBLISHER');
      print(await(await import('./pluginOverlays.js')).signPluginOverlay(resolve(cwd,args[2]),JSON.parse(option('json')!),resolve(cwd,keyFile),keyId));
    }
    else if (action === 'lock' && args[2]) {
      const plugin = await loadPluginAt(resolve(cwd, args[2]));
      const lock = { version: plugin.version, digest: await computePluginDigest(plugin.path) };
      const path = join(projectStateDir(cwd), 'settings.json');
      const settings = await readJson<Record<string, unknown>>(path, {});
      await writeJson(path, { ...settings, pluginLocks: { ...(settings.pluginLocks as PlatformConfig['pluginLocks']), [plugin.name]: lock } });
      const effective = await loadConfig(cwd);
      print({ name: plugin.name, requested: lock, effective: effective.pluginLocks?.[plugin.name], notice: 'A digest pin is not a publisher signature. Managed policy takes precedence.' });
    }
    else if (action === 'verify') {
      const errors = platform.diagnostics.filter((item) => item.component === 'plugin' && item.severity === 'error');
      print({ ok: !errors.length, requirePluginLocks: config.requirePluginLocks ?? false, requirePluginSignatures: config.requirePluginSignatures ?? false, loaded: platform.plugins.map(({ name, version, integrity }) => ({ name, version, pinned: Boolean(config.pluginLocks?.[name]), signatureVerified: Boolean(integrity?.signature), signingKey: integrity?.signature?.keyId })), errors });
      if (errors.length) process.exitCode = 1;
    }
    else if (action === 'install' && args[2]) {
      if (/^(?:\.|[A-Za-z]:[\\/]|[\\/])/.test(args[2])) {
        const scope = option('scope', 'project'); if (scope !== 'project' && scope !== 'local') throw new Error('--scope must be project or local');
        print(await installTrustedPlugin(cwd, resolve(cwd, args[2]), scope));
      } else {
        if (!(await listMarketplaces(cwd)).length) await ensureOfficialMarketplace(cwd);
        const scope = option('scope', 'project');
        if (scope !== 'project' && scope !== 'local') throw new Error('CCPT Marketplace scope must be project or local; user-global extensions are intentionally disabled.');
        print(await installMarketplacePlugin(cwd, args[2], { allowCommand: Boolean(flag('yes')), scope }));
      }
    } else if ((action === 'uninstall' || action === 'remove') && args[2]) {
      await uninstallMarketplacePlugin(cwd, args[2]);
      print(`Uninstalled plugin ${args[2]}`);
    } else if (action === 'update' && args[2]) {
      print(await updateMarketplacePlugin(cwd, args[2], { allowCommand: Boolean(flag('yes')) }));
    } else if (action === 'marketplace' || action === 'market') {
      const operation = args[2] ?? 'list';
      if (operation === 'add' && args[3]) print(await addMarketplace(cwd, args[3]));
      else if (operation === 'list') print(await listMarketplaces(cwd));
      else if (operation === 'plugins') print(await listMarketplacePlugins(cwd));
      else if (operation === 'errors') print(await marketplaceErrors(cwd));
      else if (operation === 'update') print(await refreshMarketplace(cwd, args[3]));
      else if (operation === 'auto-update' && args[3] && (args[4] === 'on' || args[4] === 'off')) print(await setMarketplaceAutoUpdate(cwd, args[3], args[4] === 'on'));
      else if ((operation === 'remove' || operation === 'rm') && args[3]) { await removeMarketplace(cwd, args[3]); print(`Removed marketplace ${args[3]}`); }
      else throw new Error('Usage: plugin marketplace <add <source>|list|plugins|errors|update [name]|auto-update <name> <on|off>|remove <name>>');
    } else if ((action === 'enable' || action === 'disable') && args[2]) {
      const path = join(projectStateDir(cwd), 'settings.json');
      const settings = await readJson<Record<string, unknown>>(path, {});
      const disabled = new Set(Array.isArray(settings.disabledPlugins) ? settings.disabledPlugins.filter((value): value is string => typeof value === 'string') : []);
      if (action === 'disable') disabled.add(args[2]); else disabled.delete(args[2]);
      await writeJson(path, { ...settings, disabledPlugins: [...disabled].sort() });
      await runHooks(await loadConfig(cwd), 'ConfigChange', { path, keys: ['disabledPlugins'] }, cwd);
      print(`${action === 'disable' ? 'Disabled' : 'Enabled'} plugin ${args[2]}`);
    } else if (action === 'list') print(platform.plugins.map(({ name, version, description, path }) => ({ name, version, description, path })));
    else throw new Error('Usage: plugin <create|list|show|validate|hash|install|update|uninstall|enable|disable|marketplace> ...');
    return;
  }
  if (command === 'command' && args[1]) {
    const requested = `/${args[1].replace(/^\//, '')}`;
    const registered = platform.commands.find((item) => item.name === requested);
    if (!registered) throw new Error(`Unknown extension command: ${requested}`);
    const goal = expandCommand(registered, args.slice(2).join(' '), cwd);
    print(await spawnAgent({ goal, cwd, config, role: registered.agent ?? 'lead', ...(registered.skills ? { skills: registered.skills } : {}), isolation: registered.isolation ?? 'none', background: registered.background ?? flag('background') }));
    return;
  }
  if (command === 'plugins') { print(platform.plugins); return; }
  if (command === 'mcp') {
    const action = args[1] ?? 'list';
    if (action === 'create' && args[2]) print(await createMcpScaffold(cwd, args[2]));
    else if (action === 'list') print(Object.fromEntries(configuredMcpServers(config)));
    else if (action === 'add' && args[2]) {
      const transport = option('url') ? 'http' : 'stdio';
      const url = option('url');
      const executable = option('command');
      const tokenEnv = option('token-env');
      const oauthClientId = option('oauth-client-id');
      const oauthTokenUrl = option('oauth-token-url');
      const oauthDeviceUrl = option('oauth-device-url');
      const issuer = option('oauth-issuer'), authorizationUrl = option('oauth-authorization-url'), metadataUrl = option('oauth-metadata-url');
      const oauth = oauthClientId || oauthTokenUrl || issuer || authorizationUrl ? { ...(oauthClientId ? { clientId: oauthClientId } : {}), ...(oauthTokenUrl ? { tokenUrl: oauthTokenUrl } : {}), ...(issuer ? { issuer } : {}), ...(authorizationUrl ? { authorizationUrl } : {}), ...(metadataUrl ? { metadataUrl } : {}), ...(oauthDeviceUrl ? { deviceAuthorizationUrl: oauthDeviceUrl } : {}), ...(option('oauth-scopes') ? { scopes: (option('oauth-scopes') ?? '').split(',').filter(Boolean) } : {}) } : undefined;
      if (transport === 'http' && !url) throw new Error('--url is required for HTTP MCP');
      if (transport === 'stdio' && !executable) throw new Error('--command is required for stdio MCP');
      const httpMode = option('http-mode') ?? 'direct';
      if (!['direct', 'streamable'].includes(httpMode)) throw new Error('--http-mode must be direct or streamable');
      await saveMcpServer(cwd, args[2], transport === 'http'
        ? { transport, url: url as string, httpMode: httpMode as 'direct' | 'streamable', ...(tokenEnv ? { tokenEnv } : {}), ...(oauth ? { oauth } : {}) }
        : { transport, command: executable as string, args: (option('args') ?? '').split(',').filter(Boolean), ...(tokenEnv ? { tokenEnv } : {}), ...(oauth ? { oauth } : {}) });
      print(`Added MCP server ${args[2]}`);
    } else if (action === 'test' && args[2]) {
      const server = config.mcpServers[args[2]]; if (!server) throw new Error(`Unknown MCP server ${args[2]}`);
      print(await inspectMcpServer(args[2], server, config));
    } else if(action==='acceptance'&&args[2]){
      const {withExecutionSignal}=await import('./executionControl.js'),controller=new AbortController(),cancel=()=>controller.abort();process.once('SIGINT',cancel);process.once('SIGTERM',cancel);
      try{const report=await withExecutionSignal(controller.signal,()=>(import('./mcp.js')).then(api=>api.acceptMcpDeployment(cwd,args[2]!,config,{confirmed:flag('confirm'),maxRequests:Number(option('max-requests')),timeoutMs:Number(option('timeout','20000'))})));print(report);process.exitCode=report.ok?0:1;}finally{EventEmitter.prototype.removeListener.call(process,'SIGINT',cancel);EventEmitter.prototype.removeListener.call(process,'SIGTERM',cancel);}
    } else if (action === 'login' && args[2]) {
      const chunks: Buffer[] = []; let tokenBytes = 0; for await (const chunk of process.stdin) { const value = Buffer.from(chunk); tokenBytes += value.length; if (tokenBytes > 256000) throw new Error('MCP token input exceeds 256 KB'); chunks.push(value); }
      const token = Buffer.concat(chunks).toString('utf8').trim();
      if (!token) throw new Error('Pipe the MCP token through stdin');
      await loginMcp(args[2], token, config); print(`Stored token for ${args[2]} (${config.mcpCredentialBackend ?? 'file'})`);
    } else if (action === 'oauth-login' && args[2]) {
      const server = config.mcpServers[args[2]]; if (!server) throw new Error(`Unknown MCP server ${args[2]}`);
      const flow = option('flow', server.oauth?.deviceAuthorizationUrl ? 'device' : 'code');
      if (flow !== 'device' && flow !== 'code') throw new Error('--flow must be device or code');
      const { withExecutionSignal } = await import('./executionControl.js');
      const controller = new AbortController(), cancel = () => controller.abort();
      process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
      try {
        await withExecutionSignal(controller.signal, async () => {
          if (flow === 'device') await loginMcpDeviceFlow(args[2]!, server, config, ({ verificationUri, userCode }) => print(`Open ${verificationUri}\nEnter code: ${userCode}\nWaiting for authorization...`));
          else {
            const { loginMcpAuthorizationCode } = await import('./mcpOAuth.js');
            const redirectUri = option('redirect-uri');
            await loginMcpAuthorizationCode(args[2]!, server, config, {
              timeoutMs: Number(option('timeout', '300000')), register: flag('register'), ...(redirectUri ? { redirectUri } : {}),
              onAuthorization: ({ authorizationUrl }) => print(`Open this URL in a trusted browser:\n${authorizationUrl}\n${flag('manual') ? 'Paste the full callback URL here (not in command arguments):' : 'Waiting for the loopback callback; Ctrl+C cancels.'}`),
              ...(flag('manual') ? { receiveCallback: async (_details: unknown, signal: AbortSignal) => {
                const input = createInterface({ input: process.stdin });
                try { const value = await input.question('', { signal }); if (value.length > 16384) throw new Error('OAuth callback exceeds limit'); return value.trim(); }
                finally { input.close(); }
              } } : {}),
            });
          }
        });
      } finally { EventEmitter.prototype.removeListener.call(process, 'SIGINT', cancel); EventEmitter.prototype.removeListener.call(process, 'SIGTERM', cancel); }
      print(`OAuth login completed for ${args[2]}`);
    } else if (action === 'oauth-discover' && args[2]) {
      const server = config.mcpServers[args[2]]; if (!server) throw new Error(`Unknown MCP server ${args[2]}`);
      const { discoverMcpOAuth } = await import('./mcpOAuth.js'); print(await discoverMcpOAuth(server, config));
    } else if (action === 'migrate-credentials') {
      const { migrateMcpCredentials } = await import('./mcpCredentials.js');
      print({ migrated: await migrateMcpCredentials(config), backend: config.mcpCredentialBackend });
    } else if (action === 'logout' && args[2]) { await logoutMcp(args[2], config); print(`Removed token for ${args[2]}`); }
    else if (action === 'call' && args[2] && args[3]) {
      const server = config.mcpServers[args[2]]; if (!server) throw new Error(`Unknown MCP server ${args[2]}`);
      if((flag('interactive-url')||flag('interactive-tools')||flag('interactive-audio'))&&!flag('interactive'))throw new Error('--interactive-url/--interactive-tools/--interactive-audio also requires --interactive');
      const interactions = flag('interactive') ? (await import('./mcpInteractiveCli.js')).createInteractiveMcpHandlers(args[2], config,{url:flag('interactive-url'),tools:flag('interactive-tools'),audio:flag('interactive-audio')}) : undefined;
      const { withExecutionSignal } = await import('./executionControl.js');
      const controller = new AbortController(), cancel = () => controller.abort();
      process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
      try {
        print(await withExecutionSignal(controller.signal, () => callMcpServer(args[2]!, server, args[3]!, JSON.parse(option('json', '{}') ?? '{}') as Record<string, unknown>, config.policy.allowNetwork,
          (value) => process.stderr.write(`[mcp event] ${JSON.stringify(configForDisplay(value))}\n`), config, interactions)));
      } finally { EventEmitter.prototype.removeListener.call(process, 'SIGINT', cancel); EventEmitter.prototype.removeListener.call(process, 'SIGTERM', cancel); }
    } else if (action === 'resources') print(await listMcpResources(config, args[2]));
    else if (action === 'read-resource' && args[2] && args[3]) print(await readMcpResource(config, args[2], args[3]));
    else if (action === 'prompts') print(await listMcpPrompts(config, args[2]));
    else if (action === 'get-prompt' && args[2] && args[3]) print(await getMcpPrompt(config, args[2], args[3], JSON.parse(option('json', '{}') ?? '{}') as Record<string, string>));
    else throw new Error('Usage: mcp <create|list|add|test|login|oauth-login|logout|migrate-credentials|call|resources|read-resource|prompts|get-prompt>');
    return;
  }
  if (command === 'lsp') {
    const action = args[1] ?? 'list';
    if (action === 'list') print(config.lspServers);
    else if (action === 'add' && args[2]) {
      const executable = option('command');
      const extensions = (option('extensions') ?? '').split(',').filter(Boolean);
      const languageId = option('language-id');
      if (!executable || !languageId || extensions.length === 0) throw new Error('lsp add requires --command, --language-id, and --extensions');
      const path = join(projectStateDir(cwd), 'settings.json');
      const settings = await readJson<Record<string, unknown>>(path, {});
      const lspServers = (settings.lspServers ?? {}) as Record<string, unknown>;
      lspServers[args[2]] = { command: executable, args: (option('args') ?? '').split(',').filter(Boolean), extensions, languageId };
      await writeJson(path, { ...settings, lspServers });
      print(`Added LSP server ${args[2]}`);
    } else if (action === 'query' && args[2] && args[3]) {
      const lspQuery = option('query');
      const lspServer = option('server');
      const request = { operation: args[2] as never, filePath: args[3], line: Number(option('line', '1')), character: Number(option('character', '1')), ...(lspQuery ? { query: lspQuery } : {}), ...(lspServer ? { server: lspServer } : {}) };
      print(formatLspResult(await executeLspRequest(request, cwd, config), cwd));
    } else throw new Error('Usage: lsp <list|add <name> --command CMD --args a,b --extensions .ts,.tsx --language-id typescript|query <operation> <file> [--line N --character N --server NAME]>');
    return;
  }
  if (command === 'output-style') {
    const action = args[1] ?? 'list';
    const styles = await getOutputStyleDirStyles(cwd);
    if (action === 'list') print(styles.map(({ name, description, source, path }) => ({ name, description, source, path, active: config.outputStyle === name })));
    else if (action === 'show' && args[2]) print(styles.find((style) => style.name.toLowerCase() === args[2]?.toLowerCase()) ?? { error: 'not found' });
    else if (action === 'set' && args[2]) {
      const style = styles.find((item) => item.name.toLowerCase() === args[2]?.toLowerCase());
      if (!style) throw new Error(`Unknown output style: ${args[2]}`);
      const path = join(projectStateDir(cwd), 'settings.json');
      const settings = await readJson<Record<string, unknown>>(path, {});
      await writeJson(path, { ...settings, outputStyle: style.name });
      print(`Active output style: ${style.name}`);
    } else throw new Error('Usage: output-style <list|show|set> [name]');
    return;
  }
  if (command === 'coordinator') {
    const action = args[1] ?? 'status';
    if (action === 'status') print({ coordinatorMode: config.coordinatorMode });
    else if (action === 'on' || action === 'off') {
      const path = join(projectStateDir(cwd), 'settings.json');
      const settings = await readJson<Record<string, unknown>>(path, {});
      await writeJson(path, { ...settings, coordinatorMode: action === 'on' });
      print(`Coordinator mode ${action}`);
    } else throw new Error('Usage: coordinator <on|off|status>');
    return;
  }
  if (command === 'permissions') {
    const action = args[1] ?? 'list';
    if (action === 'list') print(config.policy.permissionRules);
    else if (action === 'recent') print(await listPermissionDenials(cwd));
    else if (action === 'check' && args[2]) {
      const input = JSON.parse(option('json', '{}') ?? '{}') as Record<string, unknown>;
      const result = evaluatePermission(args[2], input, config);
      print(result ? { ...result, explanation: explainPermission(result) } : { behavior: 'default', reason: 'No configured permission rule matched.' });
    } else throw new Error('Usage: permissions <list|recent|check <tool> --json input>');
    return;
  }
  if (command === 'stats') { print(getRuntimeState()); return; }
  if (command === 'hooks') {
    if (args[1] === 'matrix') { const { hookCompatibilityMatrix } = await import('./hookContracts.js'); print(hookCompatibilityMatrix()); }
    else if (args[1] === 'run' && args[2]) { await runHooks(config, args[2] as never, { manual: true }, cwd); print('hooks completed'); }
    else print(config.hooks);
    return;
  }
  if (command === 'config') {
    const action = args[1] ?? 'show';
    if (action === 'show') { print(configForDisplay(config)); return; }
    if (action === 'set') {
      const baseUrl = option('base-url');
      const endpointUrl = option('endpoint-url');
      const apiKeyHeader = option('api-key-header');
      const apiKeyPrefix = option('api-key-prefix') ?? (apiKeyHeader ? (apiKeyHeader.toLowerCase() === 'authorization' ? 'Bearer ' : '') : undefined);
      const apiProtocol = option('api-protocol');
      const responsesTransport = option('responses-transport');
      if (responsesTransport && !['native', 'chat-completions'].includes(responsesTransport)) throw new Error('--responses-transport must be native or chat-completions');
      const apiPreset = option('api-preset');
      const chatToolReasoning = option('chat-tool-reasoning');
      if (chatToolReasoning && !['preserve', 'none', 'omit', 'responses-only'].includes(chatToolReasoning)) throw new Error('--chat-tool-reasoning must be preserve, none, omit or responses-only');
      const responsesStore = option('responses-store');
      const responseSchema = option('response-schema');
      const clearResponseSchema = flag('clear-response-schema');
      if (responsesStore && !['enabled', 'disabled'].includes(responsesStore)) throw new Error('--responses-store must be enabled or disabled');
      if (responseSchema && clearResponseSchema) throw new Error('Choose --response-schema or --clear-response-schema');
      const responsesTextFormat = responseSchema ? JSON.parse(await readFile(resolve(cwd, responseSchema), 'utf8')) as PlatformConfig['model']['responsesTextFormat'] : undefined;
      const apiKeyEnv = option('api-key-env');
      const tokenField = option('token-field');
      const marketplace = option('marketplace');
      const caFile = option('ca-file');
      const clearCa = flag('clear-ca');
      if (apiProtocol && !['messages', 'chat-completions', 'responses'].includes(apiProtocol)) throw new Error('--api-protocol must be messages, chat-completions or responses');
      if (apiPreset && !API_PRESETS.includes(apiPreset as ApiPreset)) throw new Error(`--api-preset must be ${API_PRESETS.join(', ')}`);
      if (apiPreset && !baseUrl && !endpointUrl) throw new Error('--api-preset resets the old URL/auth; provide --endpoint-url or --base-url');
      if (apiPreset && apiProtocol && apiPresetPatch(apiPreset as ApiPreset).apiProtocol !== apiProtocol) throw new Error('--api-preset and --api-protocol disagree');
      if (apiKeyEnv && !/^[A-Z_][A-Z0-9_]*$/i.test(apiKeyEnv)) throw new Error('--api-key-env expects an environment variable name, not a token');
      if (tokenField && !['max_tokens', 'max_completion_tokens'].includes(tokenField)) throw new Error('--token-field must be max_tokens or max_completion_tokens');
      if (marketplace && !['enabled', 'disabled'].includes(marketplace)) throw new Error('--marketplace must be enabled or disabled');
      if (caFile) await readCaCertificates(resolve(cwd, caFile));
      const model = option('model');
      const maxContext = Number(option('max-context'));
      const maxOutput = Number(option('max-output'));
      for (const flagName of ['max-context', 'max-output']) {
        const raw = option(flagName);
        if (raw !== undefined && (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0)) throw new Error(`--${flagName} requires a positive whole number`);
      }
      const allowedHost = option('allow-host');
      const clearAllowedHosts = flag('clear-allowed-hosts');
      if (allowedHost && !/^(?:\*\.)?[a-zA-Z0-9.-]+$/.test(allowedHost)) throw new Error(`Invalid allowed network host: ${allowedHost}`);
      if (baseUrl) new URL(baseUrl);
      if (endpointUrl) new URL(endpointUrl);
      if (flag('allow-git-push') && flag('deny-git-push')) throw new Error('Choose either --allow-git-push or --deny-git-push');
      if (flag('allow-pull-requests') && flag('deny-pull-requests')) throw new Error('Choose either --allow-pull-requests or --deny-pull-requests');
      const allowGitPush = flag('allow-git-push') ? true : flag('deny-git-push') ? false : undefined;
      const allowPullRequests = flag('allow-pull-requests') ? true : flag('deny-pull-requests') ? false : undefined;
      if (!baseUrl && !endpointUrl && !apiPreset && !chatToolReasoning && !apiKeyHeader && apiKeyPrefix === undefined && !apiProtocol && !responsesTransport && !apiKeyEnv && !tokenField && !marketplace && !caFile && !clearCa && !model && !(maxContext > 0) && !(maxOutput > 0) && !allowedHost && !clearAllowedHosts && allowGitPush === undefined && allowPullRequests === undefined && !responsesStore && !responseSchema && !clearResponseSchema) throw new Error('Provide model, network, marketplace, Git push, and/or pull-request settings');
      const path = join(flag('global') ? homeStateDir() : projectStateDir(cwd), 'settings.json');
      const settings = await readJson<Record<string, unknown>>(path, {});
      const currentModel = typeof settings.model === 'string' ? { name: settings.model } as Record<string, unknown> : (settings.model ?? {}) as Record<string, unknown>;
      const currentNetwork = (settings.network ?? {}) as Record<string, unknown>;
      const currentPolicy = (settings.policy ?? {}) as Record<string, unknown>;
      const existingHosts = Array.isArray(currentNetwork.allowedHosts) ? currentNetwork.allowedHosts.map(String) : [];
      const allowedHosts = clearAllowedHosts ? [] : allowedHost ? [...new Set([...existingHosts, allowedHost])] : existingHosts;
      const changesModel = Boolean(baseUrl || endpointUrl || apiPreset || chatToolReasoning || apiProtocol || responsesTransport || apiKeyEnv || tokenField || apiKeyHeader || apiKeyPrefix !== undefined || model || maxContext > 0 || maxOutput > 0 || responsesStore || responseSchema || clearResponseSchema);
      const modelSettings = { ...currentModel, provider: currentModel.provider ?? config.model.provider,
        ...(responsesTransport ? { responsesTransport } : {}),
        ...(maxOutput > 0 ? { maxOutputTokens: maxOutput } : {}),
        ...(apiPreset ? apiPresetPatch(apiPreset as ApiPreset) : {}),
        ...(chatToolReasoning ? { chatToolReasoning } : {}),
        ...(responsesStore ? { responsesStore: responsesStore === 'enabled' } : {}),
        ...(responsesTextFormat ? { responsesTextFormat } : {}),
        ...(baseUrl ? { baseUrl, endpointUrl: '' } : {}), ...(endpointUrl ? { endpointUrl } : {}), ...(apiProtocol ? { apiProtocol } : {}), ...(apiKeyEnv ? { apiKeyEnv } : {}), ...(tokenField ? { completionTokenField: tokenField } : {}), ...(apiKeyHeader ? { apiKeyHeader } : {}), ...(apiKeyPrefix !== undefined ? { apiKeyPrefix } : {}), ...(model ? { name: model } : {}), ...(Number.isFinite(maxContext) && maxContext > 0 ? { maxContextTokens: Math.floor(maxContext) } : {}) };
      if (clearResponseSchema || (responseSchema && responsesTextFormat === null)) modelSettings.responsesTextFormat = null;
      const updatedSettings = {
        ...settings,
        ...(changesModel ? { model: modelSettings } : {}),
        ...(marketplace ? { marketplaceEnabled: marketplace === 'enabled' } : {}),
        ...((allowedHost || clearAllowedHosts || caFile || clearCa) ? { network: { ...currentNetwork, ...(allowedHost || clearAllowedHosts ? { allowedHosts } : {}), ...(caFile ? { caFile: resolve(cwd, caFile) } : clearCa ? { caFile: '' } : {}) } } : {}),
        ...((allowGitPush !== undefined || allowPullRequests !== undefined) ? { policy: { ...currentPolicy, ...(allowGitPush !== undefined ? { allowGitPush } : {}), ...(allowPullRequests !== undefined ? { allowPullRequests } : {}) } } : {}),
      };
      validateConfig({ ...config, ...(marketplace ? { marketplaceEnabled: marketplace === 'enabled' } : {}), model: { ...config.model, ...(changesModel ? modelSettings : {}) } as PlatformConfig['model'], network: { ...config.network, ...updatedSettings.network } });
      await writeJson(path, updatedSettings);
      const updated = await loadConfig(cwd);
      await runHooks(updated, 'ConfigChange', { path, keys: ['model', 'network', 'policy'] }, cwd);
      print(configForDisplay({ savedTo: path, marketplaceEnabled: updated.marketplaceEnabled !== false, model: updated.model, network: updated.network, policy: updated.policy }));
      return;
    }
    throw new Error('Usage: ccpt config <show|set>');
  }
  if (command === 'audit') { if(args[1]==='verify')print(await(await import('./auditIntegrity.js')).verifyIntegrityAudit(option('day',new Date().toISOString().slice(0,10))!,option('anchor')));else print(await readAudit(args[1]));return; }
  if (command === 'remote') {
    const action = args[1];
    if (action === 'create') {
      const baseUrl = option('url', config.remote.serverUrl);
      if (!baseUrl) throw new Error('Remote server URL is required (--url or remote.serverUrl)');
      const tokenEnvironment = option('token-env', config.remote.authTokenEnv) ?? config.remote.authTokenEnv;
      const token = process.env[tokenEnvironment];
      if (!token) throw new Error(`Remote credential environment variable is not set: ${tokenEnvironment}`);
      const session = await createDirectConnectSession({ baseUrl, token }, { cwd, bypassPermissions: flag('bypass-permissions') }, config.network);
      await saveRemoteSession(session);
      print(session);
      return;
    }
    if (action === 'list') { print(await listRemoteSessions()); return; }
    if (action === 'trust') {
      const label = args[2]; const publicIdentity = args[3];
      if (!label || !publicIdentity) throw new Error('Usage: ccpt remote trust <label> <public-identity>');
      print(await trustDevice(label, publicIdentity));
      return;
    }
    if (action === 'revoke') {
      if (!args[2]) throw new Error('Usage: ccpt remote revoke <device-id>');
      print({ revoked: await revokeTrustedDevice(args[2]) });
      return;
    }
    if (action === 'devices') { print(await listTrustedDevices()); return; }
    throw new Error('Usage: ccpt remote <create|list|trust|devices|revoke>');
  }
  if (command === 'ide' && args[1] === 'serve') { await serveIdeBridge(config, cwd); return; }
  if (command === 'ide' && args[1] === 'install') { print(`Installed VS Code extension: ${await installVsCodeExtension(VERSION)}\nRestart VS Code, then run “CCPT: Open Agent Panel”.`); return; }
  if (command === 'doctor') { if (args[1] === 'errors') {const {listModelErrors,modelErrorLogPath}=await import('./modelErrorLog.js');print({path:modelErrorLogPath(),errors:await listModelErrors(Number(option('limit','10'))),note:'Bounded/redacted model errors, not all process output. Review before sharing.'});} else if (args[1] === 'export' && args[2]) print({ path: await exportDiagnosticBundle(cwd, args[2], config, VERSION), localOnly: true }); else await doctor(cwd); return; }
  if (command === 'automation') {
    const scheduler = await import('./automationScheduler.js');
    const management = await import('./schedulerManagement.js');
    if(args[1]==='prepare-goal'&&args[2])print(await(await import('./scheduledWorkflows.js')).prepareScheduledGoal(cwd,process.env.CCPT_CLI_ENTRY??process.argv[1]!,args[2],Number(option('expected-version')),flag('confirm'),Number(option('minutes','5')),option('at')));
    else if(args[1]==='prepare-backup')print(await(await import('./scheduledWorkflows.js')).prepareScheduledBackup(cwd,process.env.CCPT_CLI_ENTRY??process.argv[1]!,Number(option('max-runs','3')),flag('confirm'),Number(option('minutes','60')),option('at')));
    else if(args[1]==='workflow-runs'&&args[2])print(await(await import('./scheduledWorkflows.js')).inspectScheduledWorkflows(args[2]));
    else if(args[1]==='backup-reconcile'&&args[2])print(await(await import('./scheduledWorkflows.js')).reconcileScheduledBackup(args[2],option('expected-digest','')!,flag('confirm')));
    else if (args[1] === 'list' || !args[1]) print(await management.listAutomationSchedulers());
    else if (args[1] === 'status' && args[2]) print(await management.inspectAutomationScheduler(args[2],true));
    else if (args[1] === 'recover' && args[2]) print(await management.recoverAutomationScheduler(args[2],option('expected-digest','')!,flag('confirm')));
    else if (args[1] === 'runs' && args[2]) print(await(await import('./scheduledAgent.js')).inspectReadOnlyRuns(args[2]));
    else if (args[1] === 'migration-preview' && args[2]) print(await(await import('./schedulerMigration.js')).previewSchedulerMigration(args[2],process.env.CCPT_CLI_ENTRY??process.argv[1]!));
    else if (args[1] === 'migrate' && args[2]) print(await(await import('./schedulerMigration.js')).migrateLegacyScheduler(args[2],process.env.CCPT_CLI_ENTRY??process.argv[1]!,option('expected-digest','')!,flag('confirm')));
    else if (args[1] === 'rebind' && args[2]) print(await management.rebindAutomationScheduler(args[2],process.env.CCPT_CLI_ENTRY ?? process.argv[1]!,option('expected-digest','')!,flag('confirm')));
    else if (args[1] === 'uninstall' && args[2]) print(await management.uninstallAutomationScheduler(args[2],option('expected-digest','')!,flag('confirm')));
    else if (args[1] === 'prepare' && flag('agent-mode')) {
      if(option('agent-mode')!=='read-only'||!option('max-requests')||!option('max-tokens'))throw new Error('Explicit read-only mode requires --max-requests and --max-tokens; no permissive unattended mode exists');
      print(await(await import('./scheduledAgent.js')).prepareReadOnlyAutomation(cwd,process.env.CCPT_CLI_ENTRY ?? process.argv[1]!,{maxRequests:Number(option('max-requests')),maxTokens:Number(option('max-tokens')),maxRuns:Number(option('max-runs','3'))},Number(option('minutes','5'))));
    }
    else if (args[1] === 'prepare') print(await scheduler.prepareAutomationScheduler(cwd, process.env.CCPT_CLI_ENTRY ?? process.argv[1]!, Number(option('minutes', '5')), flag('repair-corrupt')));
    else if (args[1] === 'install' && args[2]) print(await scheduler.installAutomationScheduler(args[2], flag('confirm')));
    else if (args[1] === 'disable' && args[2]) print(await scheduler.disableAutomationScheduler(args[2], flag('confirm')));
    else if (args[1] === 'tick' && args[2]) print(await scheduler.tickAutomationScheduler(args[2]));
    else throw new Error('Usage: automation list | status ID | prepare | install ID --confirm | tick ID | disable ID --confirm | rebind/uninstall ID --expected-digest DIGEST --confirm');
    return;
  }
  if(command==='operations'){
    const api=await import('./operationRecovery.js'),action=args[1]??'list',id=args[2];
    if(action==='list')print(await api.listOperations(cwd));
    else if(action==='show'&&id)print(await api.inspectOperation(cwd,id));
    else if(action==='query'&&id)print(await api.queryOperation(cwd,id,config));
    else if(action==='resolve'&&id){if(!flag('confirm'))throw new Error('Manual external-outcome verification requires --confirm');print(await api.resolveOperation(cwd,id,Number(option('expected-version')),option('status') as 'completed'|'not_applied',option('reason','')!));}
    else if(action==='compensate'&&id)print(await api.compensateOperation(cwd,id,Number(option('expected-version')),option('reason','')!,config,flag('confirm')));
    else throw new Error('Usage: operations list|show ID|query ID|resolve ID --status completed|not_applied --reason TEXT --expected-version N --confirm|compensate ID --reason TEXT --expected-version N --confirm');return;
  }
  if (command === 'wakeups') {
    if (args[1] === 'bind' && args[2] && args[3]) { if (!flag('confirm')) throw new Error('Binding wakeup context to a paid job requires --confirm'); print(await (await import('./automation.js')).bindWakeupToJob(args[2], args[3], cwd)); }
    else if (args[1] === 'schedule' && args[2]) { const at = option('at'), prompt = option('prompt'); if (!at || !prompt) throw new Error('Usage: wakeups schedule SESSION --at ISO --prompt TEXT [--job JOB]'); print(await (await import('./automation.js')).scheduleWakeup({ sessionId: args[2], prompt, runAt: at, ...(option('job') ? { jobId: option('job')! } : {}) }, cwd)); }
    else if (args[1] === 'repair') { const { repairAutomationState } = await import('./automationRecovery.js'); print(await repairAutomationState(cwd, { confirm: flag('confirm'), expectedDigest: option('expected-digest', '')! })); }
    else if (args[1] === 'doctor') { const { automationDiagnostics } = await import('./automation.js'); print(await automationDiagnostics(cwd)); }
    else print(args[1] === 'cancel' && args[2] ? await cancelWakeup(args[2], cwd) : await listWakeups(cwd)); return;
  }
  if (command === 'goals' && args[2]) {
    const session = await (await import('./sessionHistoryView.js')).scopedSession(cwd, args[2]);
    const api = await import('./automation.js');
    if (args[1] === 'list') print(await api.listSessionGoals(session.id, cwd));
    else if (args[1] === 'set' && option('objective')) print(await api.setSessionGoal({ sessionId: session.id, objective: option('objective')! }, cwd));
    else if (args[1] === 'decide' && args[3] && option('status')) {
      if (!(await api.listSessionGoals(session.id, cwd)).some(goal => goal.id === args[3])) throw new Error('Goal not found in this session');
      print(await api.transitionSessionGoal(args[3], option('status') as import('./automation.js').GoalDefinition['status'], Number(option('expected-version')), cwd, option('reason')));
    } else throw new Error('Usage: goals list SESSION | set SESSION --objective TEXT | decide SESSION GOAL --status STATUS --expected-version N [--reason TEXT]');
    return;
  }
  if (command === 'responses') {
    const action = args[1], id = args[2];
    if (!id || !['get', 'delete'].includes(action ?? '')) throw new Error('Usage: ccpt responses get <id> | delete <id> --confirm');
    if (action === 'delete' && !flag('confirm')) throw new Error('Remote deletion is irreversible. Repeat with --confirm to delete only this response ID. Local history will not be deleted.');
    print(await responseRecord(config, id, action === 'delete' ? 'DELETE' : 'GET'));
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  if ((flag('print') || rawArgs.includes('-p')) && ['json', 'stream-json'].includes(option('output-format') ?? '')) {
    process.stdout.write(`${JSON.stringify({ type: 'result', schema_version: 1, status: 'failed', is_error: true, error: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1; return;
  }
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
