import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { boundedWorkspaceFiles } from './boundedWalk.js';
import { assertExecutionActive } from './executionControl.js';
import { dirname, relative, resolve } from 'node:path';
import type { ToolContext, ToolDefinition } from './types.js';
import { resolveWorkspacePath } from './paths.js';
import { protectPath, executeCommand } from './policy.js';
import { getMemory, listMemory, setMemory } from './memory.js';
import { agentMemoryDirectory, listAgentMemory, readAgentMemory, writeAgentMemory } from './agentMemory.js';
import { runHooks } from './hooks.js';
import { audit } from './audit.js';
import { callMcpServer, getMcpPrompt, listMcpPrompts, listMcpResources, readMcpResource } from './mcp.js';
import { claimTask, createTask, listTasks, loadTask, updateTask } from './tasks.js';
import { createCheckpoint, listCheckpoints, restoreCheckpoint } from './checkpoints.js';
import type { TaskStatus } from './types.js';
import { editNotebook, readNotebook } from './notebooks.js';
import { discoverTeam, readTeamMailbox, sendTeamMessage, broadcastTeamMessage, requestTeamShutdown } from './mailbox.js';
import { ToolRegistry } from './Tool.js';
import { ToolSearchTool, searchToolCatalog } from './tools/ToolSearchTool/ToolSearchTool.js';
import { ListMcpResourcesTool } from './tools/ListMcpResourcesTool/ListMcpResourcesTool.js';
import { ReadMcpResourceTool } from './tools/ReadMcpResourceTool/ReadMcpResourceTool.js';
import { GetMcpPromptTool, ListMcpPromptsTool } from './tools/MCPTool/promptTools.js';
import { LSPTool } from './tools/LSPTool/LSPTool.js';
import { parseLspInput } from './tools/LSPTool/schemas.js';
import { formatLspResult } from './tools/LSPTool/formatters.js';
import { executeLspRequest } from './services/lsp/manager.js';
import { BackgroundShellTool } from './tools/BashTool/BackgroundShellTool.js';
import { TaskOutputTool } from './tools/TaskOutputTool/TaskOutputTool.js';
import { TaskStopTool } from './tools/TaskStopTool/TaskStopTool.js';
import { getShellTaskOutput, startShellTask, stopShellTask } from './tasks/LocalShellTask/LocalShellTask.js';
import { recordToolExecution } from './bootstrap/state.js';
import { evaluatePermission } from './utils/permissions/permissions.js';
import { TaskGetTool, executeTaskGet } from './tools/TaskGetTool/TaskGetTool.js';
import { TeamCreateTool, executeTeamCreate } from './tools/TeamCreateTool/TeamCreateTool.js';
import { TeamDeleteTool, executeTeamDelete } from './tools/TeamDeleteTool/TeamDeleteTool.js';
import { TodoWriteTool, executeTodoWrite } from './tools/TodoWriteTool/TodoWriteTool.js';
import { SleepTool, executeSleep } from './tools/SleepTool/prompt.js';
import { SyntheticOutputTool, executeSyntheticOutput } from './tools/SyntheticOutputTool/SyntheticOutputTool.js';
import { BashTool, executeBashTool } from './tools/BashTool/BashTool.js';
import { PowerShellTool, executePowerShellTool } from './tools/PowerShellTool/PowerShellTool.js';
import { ConfigTool, executeConfigTool } from './tools/ConfigTool/ConfigTool.js';
import { EnterPlanModeTool, executeEnterPlanMode } from './tools/EnterPlanModeTool/EnterPlanModeTool.js';
import { ExitPlanModeV2Tool, executeExitPlanMode } from './tools/ExitPlanModeTool/ExitPlanModeV2Tool.js';
import { EnterWorktreeTool, executeEnterWorktree } from './tools/EnterWorktreeTool/EnterWorktreeTool.js';
import { ExitWorktreeTool, executeExitWorktree } from './tools/ExitWorktreeTool/ExitWorktreeTool.js';
import { isPlanMode } from './tools/modeState.js';
import { createProjectPlan } from './plans.js';
import { NonTextFileError, positiveLimit, readUtf8Text, TextFileLimitError } from './textFiles.js';
import { AgentTool } from './tools/AgentTool/AgentTool.js';
import { BriefTool, executeBrief } from './tools/BriefTool/BriefTool.js';
import { MCPTool } from './tools/MCPTool/MCPTool.js';
import { createMcpAuthTool, executeMcpAuth } from './tools/McpAuthTool/McpAuthTool.js';
import { RemoteTriggerTool, executeRemoteTrigger } from './tools/RemoteTriggerTool/RemoteTriggerTool.js';
import { CronCreateTool, executeCronCreate } from './tools/ScheduleCronTool/CronCreateTool.js';
import { CronDeleteTool, executeCronDelete } from './tools/ScheduleCronTool/CronDeleteTool.js';
import { CronListTool, executeCronList } from './tools/ScheduleCronTool/CronListTool.js';
import { SkillTool, executeSkillTool } from './tools/SkillTool/SkillTool.js';
import { WebFetchTool, executeWebFetch } from './tools/WebFetchTool/WebFetchTool.js';
import { WebSearchTool, executeWebSearch } from './tools/WebSearchTool/WebSearchTool.js';
import { ProductTools, executeProductTool } from './tools/ProductTools/index.js';
import { consumePermissionDecision, permissionRequestPayload } from './permissionApprovals.js';
import { buildPermissionPreview } from './permissionPreview.js';
import { recordPermissionDenial } from './permissionHistory.js';
import { modelCredentialNames } from './environment.js';
import { notifyLifecycle } from './lifecycleNotifications.js';
import { beginToolOperation, finishToolOperation, operationInput } from './operationRecovery.js';

export interface ToolResult { content: string; waiting?: boolean; ended?: boolean; cwdChanged?:string }
export type Delegate = (goal: string, role: string, isolation: 'none' | 'worktree', contextMode: 'isolated' | 'fork') => Promise<string>;

export const tools: ToolDefinition[] = [
  {name:'change_directory',description:'Change this Agent\'s working directory within its permitted workspace roots; other Agents and the terminal process are not changed.',input_schema:{type:'object',properties:{path:{type:'string'}},required:['path']}},
  { name: 'list_files', description: 'List workspace files recursively.', input_schema: { type: 'object', properties: { path: { type: 'string' }, limit: { type: 'number' } } } },
  { name: 'read_file', description: 'Read a UTF-8 workspace file.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Create or replace a UTF-8 workspace file after policy checks.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'notebook_read', description: 'Read Jupyter notebook cells without embedding large cell outputs.', input_schema: { type: 'object', properties: { notebook_path: { type: 'string' }, cell_id: { type: 'string' } }, required: ['notebook_path'] } },
  { name: 'notebook_edit', description: 'Replace, insert, or delete a Jupyter notebook cell. Code cell edits clear stale outputs.', input_schema: { type: 'object', properties: { notebook_path: { type: 'string' }, cell_id: { type: 'string' }, source: { type: 'string' }, cell_type: { type: 'string', enum: ['code', 'markdown'] }, edit_mode: { type: 'string', enum: ['replace', 'insert', 'delete'] } }, required: ['notebook_path'] } },
  { name: 'search_text', description: 'Search text in workspace files.', input_schema: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
  { name: 'run_command', description: 'Run an allowlisted executable with an argument array.', input_schema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['command'] } },
  { name: 'memory_list', description: 'List persistent memory keys for a scope.', input_schema: { type: 'object', properties: { scope: { type: 'string' } } } },
  { name: 'memory_read', description: 'Read persistent project or role memory.', input_schema: { type: 'object', properties: { scope: { type: 'string' }, key: { type: 'string' } }, required: ['key'] } },
  { name: 'memory_write', description: 'Store a durable engineering convention or decision.', input_schema: { type: 'object', properties: { scope: { type: 'string' }, key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] } },
  { name: 'agent_memory', description: 'Use the current specialist profile\'s workspace-scoped persistent memory. Writes require enabled memory and editing permissions. Never store secrets.', input_schema: { type: 'object', properties: { action: { type: 'string', enum: ['list', 'read', 'write'] }, key: { type: 'string' }, value: { type: 'string' } }, required: ['action'] } },
  { name: 'delegate', description: 'Start a bounded background subagent with isolated context or a copied parent-conversation fork.', input_schema: { type: 'object', properties: { goal: { type: 'string' }, role: { type: 'string' }, isolation: { type: 'string', enum: ['none', 'worktree'] }, context_mode: { type: 'string', enum: ['isolated', 'fork'] } }, required: ['goal'] } },
  { name: 'agent_status', description: 'Inspect a delegated Agent and retrieve its latest status or result.', input_schema: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] } },
  { name: 'wait_agent', description: 'Wait for a delegated Agent to finish and return its result.', input_schema: { type: 'object', properties: { agent_id: { type: 'string' }, timeout_ms: { type: 'number' } }, required: ['agent_id'] } },
  { name: 'task_list', description: 'List persistent tasks in the current Agent team.', input_schema: { type: 'object', properties: {} } },
  { name: 'task_create', description: 'Create a persistent team task with optional dependencies.', input_schema: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, dependencies: { type: 'array', items: { type: 'string' } } }, required: ['title'] } },
  { name: 'task_update', description: 'Update a task in the current Agent team.', input_schema: { type: 'object', properties: { task_id: { type: 'string' }, status: { type: 'string', enum: ['queued', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled'] }, result: { type: 'string' }, error: { type: 'string' } }, required: ['task_id'] } },
  { name: 'task_claim', description: 'Atomically claim an unowned, dependency-ready team task.', input_schema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] } },
  { name: 'team_discover', description: 'Discover Agents in the current team and their independent sessions.', input_schema: { type: 'object', properties: {} } },
  { name: 'team_send', description: 'Send a durable direct message to another Agent in the current team.', input_schema: { type: 'object', properties: { agent_id: { type: 'string' }, message: { type: 'string' } }, required: ['agent_id', 'message'] } },
  { name: 'team_broadcast', description: 'Deliver a data-only message to teammates; reports per-recipient durable deliveries and failures. Never grants permissions.', input_schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } },
  { name: 'team_shutdown', description: 'Root lead only: request cooperative shutdown of one teammate, preserving its conversation and files.', input_schema: { type: 'object', properties: { agent_id: { type: 'string' } }, required: ['agent_id'] } },
  { name: 'team_inbox', description: 'Read this Agent\'s durable team mailbox.', input_schema: { type: 'object', properties: { unread_only: { type: 'boolean' }, mark_read: { type: 'boolean' } } } },
  { name: 'checkpoint_create', description: 'Create a recoverable code checkpoint for selected files or the workspace.', input_schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } } } },
  { name: 'checkpoint_list', description: 'List code checkpoints for the current workspace.', input_schema: { type: 'object', properties: {} } },
  { name: 'checkpoint_restore', description: 'Restore code from a checkpoint after a permission check.', input_schema: { type: 'object', properties: { checkpoint_id: { type: 'string' }, restore_conversation: { type: 'boolean' } } } },
  { name: 'git_status', description: 'Show the current Git worktree status.', input_schema: { type: 'object', properties: {} } },
  { name: 'git_commit', description: 'Stage explicit files and create a Git commit after policy checks.', input_schema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, message: { type: 'string' } }, required: ['files', 'message'] } },
  { name: 'git_push', description: 'Push the current branch through the controlled Git process.', input_schema: { type: 'object', properties: { remote: { type: 'string' }, branch: { type: 'string' } } } },
  { name: 'create_draft_pr', description: 'Create a draft pull request with the configured Git hosting CLI.', input_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, base: { type: 'string' } }, required: ['title', 'body'] } },
  { name: 'mcp_call', description: 'Call a configured stdio MCP server tool.', input_schema: { type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' }, arguments: { type: 'object' } }, required: ['server', 'tool'] } },
  ListMcpResourcesTool,
  ReadMcpResourceTool,
  ListMcpPromptsTool,
  GetMcpPromptTool,
  LSPTool,
  BashTool,
  PowerShellTool,
  ConfigTool,
  EnterPlanModeTool,
  ExitPlanModeV2Tool,
  EnterWorktreeTool,
  ExitWorktreeTool,
  AgentTool,
  BriefTool,
  MCPTool,
  createMcpAuthTool(),
  RemoteTriggerTool,
  CronCreateTool,
  CronDeleteTool,
  CronListTool,
  SkillTool,
  WebFetchTool,
  WebSearchTool,
  BackgroundShellTool,
  TaskOutputTool,
  TaskStopTool,
  TaskGetTool,
  TeamCreateTool,
  TeamDeleteTool,
  TodoWriteTool,
  SleepTool,
  SyntheticOutputTool,
  ToolSearchTool,
  ...ProductTools,
  { name: 'ask_user', description: 'Pause a background task and record a question for the engineer.', input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
];

export const toolRegistry = new ToolRegistry(tools);

function stringValue(input: Record<string, unknown>, key: string, fallback?: string): string {
  const value = input[key] ?? fallback;
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  return value;
}

async function walk(directory: string, root: string, output: string[], limit: number, config: ToolContext['config'], deadlineAt = Date.now() + 10000): Promise<void> {
  if (output.length >= limit) return;
  output.push(...(await boundedWorkspaceFiles(directory, config, { limit: limit - output.length, deadlineAt })).map(path => relative(root, path)));
}

export const PLAN_SAFE_TOOLS = new Set(['list_files', 'read_file', 'search_text', 'memory_list', 'memory_read', 'agent_memory', 'task_list', 'task_get', 'team_discover', 'team_inbox', 'git_status', 'lsp', 'list_mcp_resources', 'read_mcp_resource', 'list_mcp_prompts', 'get_mcp_prompt', 'tool_search', 'skill', 'web_fetch', 'web_search', 'artifact', 'monitor', 'wait_for_mcp_servers', 'share_onboarding_guide', 'ask_user', 'ask_user_question', 'end_conversation', 'enter_plan_mode', 'exit_plan_mode']);

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
  delegate: Delegate,
): Promise<ToolResult> {
  const toolStartedAt = Date.now();
  const { config, cwd, agentId } = context;
  const teamSessionId = context.teamSessionId ?? context.sessionId;
  const preTool = await runHooks(config, 'PreToolUse', { tool: name, input, agentId }, cwd);
  if (preTool.updatedInput) input = { ...input, ...preTool.updatedInput };
  const permission = evaluatePermission(name, input, config);
  if (permission?.behavior === 'deny') {
    await recordPermissionDenial({ cwd, sessionId: context.sessionId, tool: name, subject: permission.subject, reason: permission.reason, source: 'policy' }, modelCredentialNames(config).map((key) => process.env[key] ?? ''));
    await runHooks(config, 'PermissionDenied', { tool: name, input, agentId, permission }, cwd);
    await audit({ event: `permission.${name}`, actor: agentId, sessionId: context.sessionId, outcome: 'denied', details: { reason: permission.reason } });
    throw new Error(`Permission denied: ${permission.reason}`);
  }
  const decision = await consumePermissionDecision(context.sessionId, name, input);
  if (decision === 'deny') throw new Error('User denied this tool and subject for this session. Do not retry; choose another approach.');
  const editTool = new Set(['write_file', 'edit_file', 'notebook_edit', 'apply_patch']).has(name);
  if (permission?.behavior === 'ask' && !(config.policy.mode === 'acceptEdits' && editTool) && decision !== 'allow') {
    const request = permissionRequestPayload(context.sessionId, name, input, permission.reason);
    try { request.preview = await buildPermissionPreview(name, input, cwd, config); }
    catch { request.preview = 'Preview unavailable: target cannot be read under the current workspace policy.'; }
    await runHooks(config, 'PermissionRequest', { action: 'rule-confirmation', tool: name, input, agentId, permission, requestId: request.id }, cwd);
    await audit({ event: `permission.${name}`, actor: agentId, sessionId: context.sessionId, outcome: 'requested', details: { reason: permission.reason, requestId: request.id } });
    return { content: JSON.stringify(request), waiting: true };
  }
  if (isPlanMode(context.sessionId) && !PLAN_SAFE_TOOLS.has(name)) throw new Error(`Tool ${name} is disabled while this session is in plan mode`);
  input=operationInput(context,name,input);
  const operation=await beginToolOperation(context,name,input);
  try {
  let result: ToolResult;
  let operationSucceeded=true;
  switch (name) {
    case 'change_directory': {
      const target=protectPath(resolveWorkspacePath(cwd,stringValue(input,'path'),config.policy.workspaceRoots),config);
      if(!(await stat(target)).isDirectory())throw new Error('Working directory must be an existing permitted directory');
      result={content:`Agent working directory: ${target}`,cwdChanged:target};break;
    }
    case 'list_files': {
      const root = protectPath(resolveWorkspacePath(cwd, stringValue(input, 'path', '.'), config.policy.workspaceRoots), config);
      const files: string[] = [];
      await walk(root, root, files, Math.min(Number(input.limit ?? 2_000), 10_000), config);
      result = { content: files.join('\n') };
      break;
    }
    case 'read_file': {
      const path = protectPath(resolveWorkspacePath(cwd, stringValue(input, 'path'), config.policy.workspaceRoots), config);
      result = { content: await readUtf8Text(path, 2_000_000) };
      break;
    }
    case 'write_file': {
      if (config.policy.mode === 'restricted') throw new Error('File writes are disabled in restricted mode');
      if (config.policy.mode !== 'bypass') await runHooks(config, 'PermissionRequest', { action: 'file-write', path: input.path, agentId }, cwd);
      const path = protectPath(resolveWorkspacePath(cwd, stringValue(input, 'path'), config.policy.workspaceRoots), config);
      const checkpoint = await createCheckpoint({ cwd, config, files: [path], sessionId: context.sessionId, agentId, reason: `Before write_file: ${relative(cwd, path)}` });
      let existed = false;
      try { existed = (await stat(path)).isFile(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, stringValue(input, 'content'), 'utf8');
      const notices = await notifyLifecycle(config, cwd, 'FileChanged', { path, change: existed ? 'modified' : 'created', tool: name, agentId, sessionId: context.sessionId, checkpointId: checkpoint.id });
      result = { content: [`Wrote ${relative(cwd, path)} (checkpoint ${checkpoint.id})`, ...notices].join('\n') };
      break;
    }
    case 'notebook_read': {
      const path = protectPath(resolveWorkspacePath(cwd, stringValue(input, 'notebook_path'), config.policy.workspaceRoots), config);
      result = { content: JSON.stringify(await readNotebook(path, typeof input.cell_id === 'string' ? input.cell_id : undefined), null, 2) };
      break;
    }
    case 'notebook_edit': {
      if (config.policy.mode === 'restricted') throw new Error('Notebook edits are disabled in restricted mode');
      const path = protectPath(resolveWorkspacePath(cwd, stringValue(input, 'notebook_path'), config.policy.workspaceRoots), config);
      if (config.policy.mode !== 'bypass') await runHooks(config, 'PermissionRequest', { action: 'notebook-edit', path, agentId, cellId: input.cell_id, editMode: input.edit_mode }, cwd);
      const checkpoint = await createCheckpoint({ cwd, config, files: [path], sessionId: context.sessionId, agentId, reason: `Before notebook_edit: ${relative(cwd, path)}` });
      const editModeValue = typeof input.edit_mode === 'string' ? input.edit_mode : 'replace';
      if (!['replace', 'insert', 'delete'].includes(editModeValue)) throw new Error(`Invalid notebook edit mode: ${editModeValue}`);
      const editMode = editModeValue as 'replace' | 'insert' | 'delete';
      const cellTypeValue = typeof input.cell_type === 'string' ? input.cell_type : undefined;
      if (cellTypeValue && cellTypeValue !== 'code' && cellTypeValue !== 'markdown') throw new Error(`Invalid notebook cell type: ${cellTypeValue}`);
      const cellType = cellTypeValue as 'code' | 'markdown' | undefined;
      const edited = await editNotebook({
        path,
        ...(typeof input.cell_id === 'string' ? { cellId: input.cell_id } : {}),
        ...(typeof input.source === 'string' ? { source: input.source } : {}),
        ...(cellType ? { cellType } : {}),
        mode: editMode,
      });
      const notices = await notifyLifecycle(config, cwd, 'FileChanged', { path, change: 'modified', tool: name, agentId, sessionId: context.sessionId, checkpointId: checkpoint.id });
      result = { content: [JSON.stringify({ ...edited, checkpointId: checkpoint.id }, null, 2), ...notices].join('\n') };
      break;
    }
    case 'search_text': {
      const deadline = Date.now() + 10000;
      const root = protectPath(resolveWorkspacePath(cwd, stringValue(input, 'path', '.'), config.policy.workspaceRoots), config);
      const query = stringValue(input, 'query');
      const files: string[] = [];
      const rootInfo = await stat(root);
      if (rootInfo.isFile()) files.push(relative(cwd, root));
      else await walk(root, root, files, 3_000, config, deadline);
      const matches: string[] = [];
      const limit = positiveLimit(input.limit as number | undefined, 200, 1_000);
      for (const file of files) {
        assertExecutionActive(); if (Date.now() > deadline) throw new Error('Text search exceeded its total execution time limit');
        if (matches.length >= limit) break;
        const path = protectPath(rootInfo.isFile() ? root : resolve(root, file), config);
        let text: string;
        try { text = await readUtf8Text(path, 1_000_000); }
        catch (error) { if (error instanceof NonTextFileError || error instanceof TextFileLimitError) continue; throw error; }
        text.split(/\r?\n/).forEach((line, index) => {
          if (matches.length < limit && line.includes(query)) matches.push(`${file}:${index + 1}:${line.slice(0, 300)}`);
        });
      }
      result = { content: matches.join('\n') || 'No matches' };
      break;
    }
    case 'run_command': {
      const command = stringValue(input, 'command');
      const args = Array.isArray(input.args) ? input.args.map(String) : [];
      const commandResult = await executeCommand(command, args, cwd, config, agentId);
      result = { content: `exit=${commandResult.code}\nstdout:\n${commandResult.stdout}\nstderr:\n${commandResult.stderr}` };
      break;
    }
    case 'bash': {
      const commandResult = await executeBashTool({ command: stringValue(input, 'command'), ...(typeof input.timeout === 'number' ? { timeout: input.timeout } : {}), ...(typeof input.description === 'string' ? { description: input.description } : {}) }, context);
      result = { content: `exit=${commandResult.code}\nstdout:\n${commandResult.stdout}\nstderr:\n${commandResult.stderr}` };
      break;
    }
    case 'powershell': {
      const commandResult = await executePowerShellTool({ command: stringValue(input, 'command'), ...(typeof input.timeout === 'number' ? { timeout: input.timeout } : {}), ...(typeof input.description === 'string' ? { description: input.description } : {}) }, context);
      result = { content: `exit=${commandResult.code}\nstdout:\n${commandResult.stdout}\nstderr:\n${commandResult.stderr}` };
      break;
    }
    case 'config': {
      const action = stringValue(input, 'action'); if (action !== 'get' && action !== 'set') throw new Error('action must be get or set');
      result = { content: JSON.stringify(await executeConfigTool({ action, key: stringValue(input, 'key'), ...(Object.hasOwn(input, 'value') ? { value: input.value } : {}) }, context), null, 2) };
      break;
    }
    case 'enter_plan_mode': { result = { content: JSON.stringify(executeEnterPlanMode(context)) }; break; }
    case 'exit_plan_mode': {
      const submitted = executeExitPlanMode(stringValue(input, 'plan'), context);
      const plan = await createProjectPlan({ cwd, request: 'Agent-submitted implementation plan', content: submitted.plan, sessionId: context.sessionId, planningAgentId: context.agentId });
      result = { content: JSON.stringify({ ...submitted, planId: plan.id, status: plan.status, markdownPath: plan.markdownPath, next: `/plan approve ${plan.id} or /plan changes ${plan.id} <feedback>` }, null, 2), waiting: true };
      break;
    }
    case 'enter_worktree': { result = { content: JSON.stringify(await executeEnterWorktree(context), null, 2) }; break; }
    case 'exit_worktree': { result = { content: JSON.stringify(await executeExitWorktree({ merge: input.merge === true }, context), null, 2) }; break; }
    case 'agent': {
      const isolationValue = typeof input.isolation === 'string' ? input.isolation : 'none'; if (isolationValue !== 'none' && isolationValue !== 'worktree') throw new Error('Invalid Agent isolation');
      const contextModeValue = typeof input.context_mode === 'string' ? input.context_mode : 'isolated'; if (contextModeValue !== 'isolated' && contextModeValue !== 'fork') throw new Error('Invalid Agent context mode');
      const message = await delegate(stringValue(input, 'prompt'), stringValue(input, 'agent_type', 'general-purpose'), isolationValue, contextModeValue); result = { content: message }; break;
    }
    case 'send_user_message': { result = { content: JSON.stringify(await executeBrief({ message: stringValue(input, 'message'), attachments: Array.isArray(input.attachments) ? input.attachments.map(String) : [] }, context), null, 2) }; break; }
    case 'mcp_tool': { const serverName = stringValue(input, 'server'); const server = config.mcpServers[serverName]; if (!server) throw new Error(`Unknown MCP server: ${serverName}`); result = { content: JSON.stringify(await callMcpServer(serverName, server, stringValue(input, 'tool'), input.arguments && typeof input.arguments === 'object' ? input.arguments as Record<string, unknown> : {}, config.policy.allowNetwork, undefined, config), null, 2) }; break; }
    case 'mcp_auth': { const action = stringValue(input, 'action'); if (action !== 'login' && action !== 'logout') throw new Error('Invalid MCP auth action'); result = { content: JSON.stringify(await executeMcpAuth({ server: stringValue(input, 'server'), action, ...(typeof input.token === 'string' ? { token: input.token } : {}) }, config)) }; break; }
    case 'remote_trigger': { result = { content: JSON.stringify(await executeRemoteTrigger({ url: stringValue(input, 'url'), payload: input.payload && typeof input.payload === 'object' ? input.payload as Record<string, unknown> : {} }, context), null, 2) }; break; }
    case 'cron_create': { result = { content: JSON.stringify(await executeCronCreate({ expression: stringValue(input, 'expression'), prompt: stringValue(input, 'prompt') }, cwd), null, 2) }; break; }
    case 'cron_delete': { result = { content: JSON.stringify(await executeCronDelete(stringValue(input, 'id')), null, 2) }; break; }
    case 'cron_list': { result = { content: JSON.stringify(await executeCronList(cwd), null, 2) }; break; }
    case 'skill': { result = { content: JSON.stringify(await executeSkillTool({ skill: stringValue(input, 'skill'), ...(typeof input.args === 'string' ? { args: input.args } : {}) }, context), null, 2) }; break; }
    case 'web_fetch': { result = { content: JSON.stringify(await executeWebFetch({ url: stringValue(input, 'url'), ...(typeof input.prompt === 'string' ? { prompt: input.prompt } : {}) }, context), null, 2) }; break; }
    case 'web_search': { result = { content: JSON.stringify(await executeWebSearch({ query: stringValue(input, 'query'), ...(Array.isArray(input.allowedDomains) ? { allowedDomains: input.allowedDomains.map(String) } : {}) }, context), null, 2) }; break; }
    case 'shell_start': {
      const task = await startShellTask({ command: stringValue(input, 'command'), args: Array.isArray(input.args) ? input.args.map(String) : [], cwd, config, actor: agentId, teamSessionId });
      result = { content: JSON.stringify(task, null, 2) };
      break;
    }
    case 'task_output': {
      result = { content: JSON.stringify(await getShellTaskOutput(stringValue(input, 'task_id'), Number(input.max_chars ?? 100_000), teamSessionId), null, 2) };
      break;
    }
    case 'task_stop': {
      result = { content: JSON.stringify(await stopShellTask(stringValue(input, 'task_id'), teamSessionId), null, 2) };
      break;
    }
    case 'memory_list': {
      result = { content: (await listMemory(stringValue(input, 'scope', 'project'))).join('\n') };
      break;
    }
    case 'agent_memory': {
      const { loadAgent } = await import('./agent.js'); const { loadPlatform } = await import('./platform.js');
      const record = await loadAgent(context.agentId); if (record.sessionId !== context.sessionId) throw new Error('Agent memory session mismatch');
      const profile = (await loadPlatform(record.cwd, config)).agents.find((agent) => agent.name === record.role);
      if (!profile?.memory) throw new Error('Agent persistent memory is not enabled in its definition');
      const directory = agentMemoryDirectory(record.cwd, profile); const action = stringValue(input, 'action');
      if (action === 'list') result = { content: JSON.stringify(await listAgentMemory(directory)) };
      else if (action === 'read') result = { content: await readAgentMemory(directory, stringValue(input, 'key', 'MEMORY')) };
      else if (action === 'write') {
        if (config.policy.mode === 'restricted' || isPlanMode(context.sessionId)) throw new Error('Agent memory writes are disabled in restricted/Plan mode');
        await writeAgentMemory(directory, stringValue(input, 'key', 'MEMORY'), stringValue(input, 'value')); result = { content: 'Specialist memory stored' };
      } else throw new Error('Invalid Agent memory action');
      break;
    }
    case 'memory_read': {
      result = { content: await getMemory(stringValue(input, 'scope', 'project'), stringValue(input, 'key')) };
      break;
    }
    case 'memory_write': {
      if (config.policy.mode === 'restricted') throw new Error('Memory writes are disabled in restricted mode');
      await setMemory(stringValue(input, 'scope', 'project'), stringValue(input, 'key'), stringValue(input, 'value'));
      result = { content: 'Memory stored' };
      break;
    }
    case 'delegate': {
      const isolation = input.isolation === 'none' ? 'none' : 'worktree';
      const contextMode = input.context_mode === 'fork' ? 'fork' : 'isolated';
      result = { content: await delegate(stringValue(input, 'goal'), stringValue(input, 'role', 'general'), isolation, contextMode) };
      break;
    }
    case 'agent_status': {
      const { loadAgent } = await import('./agent.js');
      const agent = await loadAgent(stringValue(input, 'agent_id'));
      if ((agent.teamSessionId ?? agent.sessionId) !== teamSessionId) throw new Error('Agent is outside the active team scope');
      result = { content: JSON.stringify({ id: agent.id, role: agent.role, status: agent.status, goal: agent.goal, result: agent.result, error: agent.error, updatedAt: agent.updatedAt }, null, 2) };
      break;
    }
    case 'wait_agent': {
      const { loadAgent, waitForAgent } = await import('./agent.js');
      const agentId = stringValue(input, 'agent_id');
      const current = await loadAgent(agentId);
      if ((current.teamSessionId ?? current.sessionId) !== teamSessionId) throw new Error('Agent is outside the active team scope');
      const timeout = Math.max(1_000, Math.min(Number(input.timeout_ms ?? 600_000), 3_600_000));
      const agent = await waitForAgent(agentId, timeout);
      result = { content: JSON.stringify({ id: agent.id, status: agent.status, result: agent.result, error: agent.error }, null, 2) };
      break;
    }
    case 'task_list': {
      result = { content: JSON.stringify(await listTasks(teamSessionId), null, 2) };
      break;
    }
    case 'task_get': {
      const task = await executeTaskGet({ task_id: stringValue(input, 'task_id') });
      if (task.teamSessionId !== teamSessionId) throw new Error('Task is outside the active team scope');
      result = { content: JSON.stringify(task, null, 2) };
      break;
    }
    case 'task_create': {
      const task = await createTask({
        teamSessionId,
        sessionId: context.sessionId,
        ...(context.taskId ? { parentTaskId: context.taskId } : {}),
        title: stringValue(input, 'title'),
        description: stringValue(input, 'description', stringValue(input, 'title')),
        dependencies: Array.isArray(input.dependencies) ? input.dependencies.map(String) : [],
      });
      await runHooks(config, 'TaskCreated', { task }, cwd);
      result = { content: JSON.stringify(task, null, 2) };
      break;
    }
    case 'task_update': {
      const taskId = stringValue(input, 'task_id');
      const current = await loadTask(taskId);
      if (current.teamSessionId !== teamSessionId) throw new Error('Task is outside the active team scope');
      const status = typeof input.status === 'string' ? input.status as TaskStatus : undefined;
      if (status && !['queued', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled'].includes(status)) throw new Error(`Invalid task status: ${status}`);
      if (status === 'completed' && current.status !== 'completed') {
        await runHooks(config, 'TaskCompleted', {
          hook_event_name: 'TaskCompleted', cwd, permission_mode: config.policy.mode,
          agentId, agent_id: agentId, sessionId: context.sessionId, session_id: context.sessionId,
          taskId, task_id: taskId, task_subject: current.title, task_description: current.description,
          team_name: teamSessionId, result: typeof input.result === 'string' ? input.result : current.result,
        }, cwd);
      }
      const task = await updateTask(taskId, {
        ...(status ? { status } : {}),
        ...(typeof input.result === 'string' ? { result: input.result } : {}),
        ...(typeof input.error === 'string' ? { error: input.error } : {}),
      });
      await runHooks(config, 'TaskUpdated', { task }, cwd);
      result = { content: JSON.stringify(task, null, 2) };
      break;
    }
    case 'task_claim': {
      const task = await claimTask(stringValue(input, 'task_id'), teamSessionId, agentId);
      result = { content: JSON.stringify(task, null, 2) };
      break;
    }
    case 'team_discover': {
      result = { content: JSON.stringify(await discoverTeam(teamSessionId), null, 2) };
      break;
    }
    case 'team_send': {
      const message = await sendTeamMessage({ teamSessionId, fromAgentId: agentId, toAgentId: stringValue(input, 'agent_id'), content: stringValue(input, 'message') });
      result = { content: JSON.stringify(message, null, 2) };
      break;
    }
    case 'team_inbox': {
      const messages = await readTeamMailbox({ teamSessionId, agentId, unreadOnly: input.unread_only !== false, markRead: input.mark_read !== false });
      result = { content: JSON.stringify(messages, null, 2) };
      break;
    }
    case 'team_broadcast': {
      result = { content: JSON.stringify(await broadcastTeamMessage({ teamSessionId, fromAgentId: agentId, content: stringValue(input, 'message') }), null, 2) }; break;
    }
    case 'team_shutdown': {
      result = { content: JSON.stringify(await requestTeamShutdown({ teamSessionId, fromAgentId: agentId, toAgentId: stringValue(input, 'agent_id') }), null, 2) }; break;
    }
    case 'team_create': {
      result = { content: JSON.stringify(await executeTeamCreate({ name: stringValue(input, 'name') }, context), null, 2) };
      break;
    }
    case 'team_delete': {
      await executeTeamDelete({ team_id: stringValue(input, 'team_id') }, context);
      result = { content: 'Team deleted' };
      break;
    }
    case 'todo_write': {
      if (!Array.isArray(input.todos)) throw new Error('todos must be an array');
      result = { content: JSON.stringify(await executeTodoWrite({ todos: input.todos as Array<{ title: string; description?: string; dependsOnPrevious?: boolean }> }, context), null, 2) };
      break;
    }
    case 'sleep': {
      await executeSleep(Number(input.milliseconds));
      result = { content: 'Sleep completed' };
      break;
    }
    case 'synthetic_output': {
      result = { content: executeSyntheticOutput({ content: stringValue(input, 'content'), ...(typeof input.repeat === 'number' ? { repeat: input.repeat } : {}) }) };
      break;
    }
    case 'checkpoint_create': {
      const files = Array.isArray(input.files)
        ? input.files.map((file) => protectPath(resolveWorkspacePath(cwd, String(file), config.policy.workspaceRoots), config))
        : undefined;
      const checkpoint = await createCheckpoint({ cwd, config, ...(files ? { files } : {}), sessionId: context.sessionId, agentId, reason: stringValue(input, 'reason', 'Agent-requested checkpoint') });
      result = { content: JSON.stringify({ id: checkpoint.id, reason: checkpoint.reason, files: checkpoint.entries.length, createdAt: checkpoint.createdAt }, null, 2) };
      break;
    }
    case 'checkpoint_list': {
      result = { content: JSON.stringify((await listCheckpoints(cwd)).map(({ id, reason, createdAt, entries }) => ({ id, reason, createdAt, files: entries.length })), null, 2) };
      break;
    }
    case 'checkpoint_restore': {
      if (config.policy.mode === 'restricted') throw new Error('Checkpoint restore is disabled in restricted mode');
      if (config.policy.mode !== 'bypass') await runHooks(config, 'PermissionRequest', { action: 'checkpoint-restore', checkpointId: input.checkpoint_id, agentId }, cwd);
      const checkpoint = await restoreCheckpoint({ cwd, config, ...(typeof input.checkpoint_id === 'string' ? { id: input.checkpoint_id } : {}), restoreConversation: input.restore_conversation === true });
      result = { content: `Restored checkpoint ${checkpoint.id} (${checkpoint.entries.length} files${input.restore_conversation === true ? ' and conversation' : ''})` };
      break;
    }
    case 'git_status': {
      const commandResult = await executeCommand('git', ['status', '--short', '--branch'], cwd, config, agentId);
      result = { content: commandResult.stdout || commandResult.stderr };
      break;
    }
    case 'git_commit': {
      const files = Array.isArray(input.files) ? input.files.map(String) : [];
      if (files.length === 0) throw new Error('git_commit requires explicit files');
      for (const file of files) resolveWorkspacePath(cwd, file, config.policy.workspaceRoots);
      const staged = await executeCommand('git', ['add', '--', ...files], cwd, config, agentId);
      if (staged.code !== 0) throw new Error(staged.stderr || 'git add failed');
      const committed = await executeCommand('git', ['commit', '-m', stringValue(input, 'message')], cwd, config, agentId);
      result = { content: `exit=${committed.code}\n${committed.stdout}${committed.stderr}` };
      break;
    }
    case 'git_push': {
      if (config.policy.mode !== 'bypass' && !config.policy.allowGitPush) throw new Error('Git push is disabled by policy');
      const remote = stringValue(input, 'remote', 'origin');
      let branch = typeof input.branch === 'string' ? input.branch : '';
      if (!branch) {
        const current = await executeCommand('git', ['branch', '--show-current'], cwd, config, agentId);
        branch = current.stdout.trim();
      }
      if (!branch) throw new Error('Unable to determine the current Git branch');
      const pushed = await executeCommand('git', ['push', '--set-upstream', remote, branch], cwd, config, agentId);
      result = { content: `exit=${pushed.code}\n${pushed.stdout}${pushed.stderr}` };
      break;
    }
    case 'create_draft_pr': {
      if (config.policy.mode !== 'bypass' && !config.policy.allowPullRequests) throw new Error('Pull request creation is disabled by policy');
      const prArgs = ['pr', 'create', '--draft', '--title', stringValue(input, 'title'), '--body', stringValue(input, 'body')];
      if (typeof input.base === 'string' && input.base) prArgs.push('--base', input.base);
      const created = await executeCommand('gh', prArgs, cwd, config, agentId);
      result = { content: `exit=${created.code}\n${created.stdout}${created.stderr}` };
      break;
    }
    case 'mcp_call': {
      const serverName = stringValue(input, 'server');
      const server = config.mcpServers[serverName];
      if (!server) throw new Error(`Unknown MCP server: ${serverName}`);
      const notifications: unknown[] = [];
      const response = await callMcpServer(serverName, server, stringValue(input, 'tool'), (input.arguments ?? {}) as Record<string, unknown>, config.policy.allowNetwork, (event) => notifications.push(event), config);
      if(response&&typeof response==='object'&&'isError' in response&&response.isError===true)operationSucceeded=false;
      result = { content: `${JSON.stringify(response, null, 2)}${notifications.length ? `\n\nMCP events received during this call:\n${JSON.stringify(notifications, null, 2)}` : ''}` };
      break;
    }
    case 'mcp_resources_list': {
      result = { content: JSON.stringify(await listMcpResources(config, typeof input.server === 'string' ? input.server : undefined), null, 2) };
      break;
    }
    case 'mcp_resource_read': {
      result = { content: JSON.stringify(await readMcpResource(config, stringValue(input, 'server'), stringValue(input, 'uri')), null, 2) };
      break;
    }
    case 'mcp_prompts_list': {
      result = { content: JSON.stringify(await listMcpPrompts(config, typeof input.server === 'string' ? input.server : undefined), null, 2) };
      break;
    }
    case 'mcp_prompt_get': {
      const promptArgs = input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)
        ? Object.fromEntries(Object.entries(input.arguments as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
        : {};
      result = { content: JSON.stringify(await getMcpPrompt(config, stringValue(input, 'server'), stringValue(input, 'prompt'), promptArgs), null, 2) };
      break;
    }
    case 'lsp': {
      result = { content: formatLspResult(await executeLspRequest(parseLspInput(input), cwd, config), cwd) };
      break;
    }
    case 'tool_search': {
      result = { content: JSON.stringify(searchToolCatalog(tools, stringValue(input, 'query'), Number(input.max_results ?? 5)), null, 2) };
      break;
    }
    case 'ask_user':
      result = { content: stringValue(input, 'question'), waiting: true };
      break;
    default: {
      const productResult = await executeProductTool(name, input, context);
      if (!productResult) throw new Error(`Unknown tool: ${name}`);
      result = productResult;
    }
  }
  await finishToolOperation(context,operation,result.content,operationSucceeded&&!/^exit=[1-9]/.test(result.content));
  await runHooks(config, 'PostToolUse', { tool: name, agentId, result: result.content.slice(0, 2_000) }, cwd);
  await audit({ event: `tool.${name}`, actor: agentId, sessionId: context.sessionId, outcome: 'success' });
  recordToolExecution(Date.now() - toolStartedAt);
  return result;
  } catch(error) {
    await finishToolOperation(context,operation,'Outcome not verified after tool failure',false).catch(()=>{});
    throw error;
  }
}
