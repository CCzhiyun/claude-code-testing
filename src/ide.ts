import { createInterface } from 'node:readline';
import type { PlatformConfig } from './types.js';
import { cancelAgent, continueAgent, listAgents, spawnAgent } from './agent.js';
import { listSessions, loadSession } from './sessions.js';
import { loadPlatform } from './platform.js';
import { createIdeEditProposal, createIdePlanReview, decideIdeEditProposal, decideIdePlanReview, listIdeConversationState } from './enhancements/ideReview.js';
import type { RuntimeEventListener } from './runtimeEvents.js';
import { createProjectPlan, listPlanRecords, loadProjectPlan, transitionProjectPlan } from './plans.js';
import { executeProjectPlan, recoverProjectPlanExecution } from './planExecution.js';
import { watchLocalState, projectStateWatchPaths } from './localStateWatch.js';
import { listTeams } from './teamStore.js';
import { resolve } from 'node:path';
import { projectEventsAfter, publishProjectInvalidation } from './projectEvents.js';
import { listProjectNotifications, markProjectNotificationsRead } from './notifications.js';
import { scopedSession, sessionHistory } from './sessionHistoryView.js';
import { runtimeHistory } from './runtimeHistory.js';
import { sameSessionWorkspace, sessionOwner } from './sessionRecovery.js';
import { listSessionGoals, setSessionGoal, transitionSessionGoal, type GoalDefinition } from './automation.js';
import {goalCandidates,listGoalWorkflows,decideGoalWorkflow,reviewGoalWorkflow} from './goalManagement.js';
import {inspectGoalWorkflow,prepareGoalWorkflow} from './goalWorkflow.js';

interface Request { id?: string | number; method?: string; params?: Record<string, unknown> }

export async function serveIdeBridge(config: PlatformConfig, cwd: string): Promise<void> {
  const write = (message: unknown): void => { process.stdout.write(`${JSON.stringify(message)}\n`); };
  const input = createInterface({ input: process.stdin });
  let stopWatch: (() => void) | undefined;
  try {
  for await (const line of input) {
    let request: Request;
    try { request = JSON.parse(line) as Request; } catch { continue; }
    try {
      let result: unknown;
      const onEvent: RuntimeEventListener = (event) => write({ jsonrpc: '2.0', method: 'runtime/event', params: { requestId: request.id, event } });
      switch (request.method) {
        case 'conflict/list':result=await(await import('./worktree.js')).inspectGitConflicts(cwd,(await loadPlatform(cwd)).config);break;
        case 'conflict/restore-preview':result=await(await import('./conflictRestore.js')).previewConflictRestore(cwd,String(request.params?.id??''),(await loadPlatform(cwd)).config);break;
        case 'conflict/restore':result=await(await import('./conflictRestore.js')).restoreConflictResolution(cwd,String(request.params?.id??''),String(request.params?.expectedDigest??''),request.params?.confirm===true,(await loadPlatform(cwd)).config);break;
        case 'conflict/review':result=await(await import('./conflictResolution.js')).reviewConflictResolution(cwd,String(request.params?.path??''),(await loadPlatform(cwd)).config);break;
        case 'conflict/resolve':result=await(await import('./conflictResolution.js')).resolveConflict(cwd,String(request.params?.path??''),String(request.params?.choice??'') as import('./conflictResolution.js').ConflictChoice,String(request.params?.expectedVersion??''),request.params?.confirm===true,(await loadPlatform(cwd)).config);break;
        case 'goal-run/candidates': result=await goalCandidates(cwd);break;
        case 'goal-run/list': result=await listGoalWorkflows(cwd);break;
        case 'goal-run/show': result=await reviewGoalWorkflow(cwd,String(request.params?.id??''));break;
        case 'goal-run/prepare': {
          if(request.params?.confirm!==true)throw new Error('Goal preparation requires explicit human confirmation');
          const p=request.params;result=await prepareGoalWorkflow(cwd,{goalId:String(p.goalId??''),planId:String(p.planId??''),expectedPlanVersion:Number(p.expectedPlanVersion),maxRequests:Number(p.maxRequests),maxTokens:Number(p.maxTokens),allowedTools:p.allowedTools as string[]});break;
        }
        case 'goal-run/decide': {
          const p=request.params??{};result=await decideGoalWorkflow(cwd,{action:String(p.action??'') as 'start'|'resume'|'recover'|'cancel',id:String(p.id??''),expectedVersion:Number(p.expectedVersion),confirm:p.confirm===true,...(typeof p.feedback==='string'?{feedback:p.feedback}:{}),...(typeof p.approveRequestId==='string'?{approveRequestId:p.approveRequestId}:{}),confirmUnknown:p.confirmUnknown===true},process.env.CCPT_CLI_ENTRY??process.argv[1]!);break;
        }
        case 'session/history': result = await sessionHistory(cwd, String(request.params?.id ?? ''), { includeText: request.params?.includeText === true, ...(request.params?.cursor !== undefined ? { cursor: String(request.params.cursor) } : {}), ...(request.params?.limit !== undefined ? { limit: Number(request.params.limit) } : {}),...(request.params?.textLimit!==undefined?{textLimit:Number(request.params.textLimit)}:{}) }); break;
        case 'runtime/history': result = await runtimeHistory(cwd, String(request.params?.id ?? ''), typeof request.params?.cursor === 'string' ? request.params.cursor : undefined, request.params?.limit === undefined ? 100 : Number(request.params.limit),{includeText:request.params?.includeText===true}); break;
        case 'runtime/replay': result=await(await import('./runtimeReplay.js')).runtimeReplay(cwd,String(request.params?.id??''),typeof request.params?.cursor==='string'?request.params.cursor:undefined,Number(request.params?.limit??100),request.params?.includeText===true);break;
        case 'goal/list': {
          const session = await scopedSession(cwd, String(request.params?.sessionId ?? ''));
          result = await listSessionGoals(session.id, cwd); break;
        }
        case 'goal/set': {
          const session = await scopedSession(cwd, String(request.params?.sessionId ?? ''));
          result = await setSessionGoal({ sessionId: session.id, objective: String(request.params?.objective ?? '') }, cwd); break;
        }
        case 'goal/decide': {
          const session = await scopedSession(cwd, String(request.params?.sessionId ?? ''));
          const goalId = String(request.params?.id ?? '');
          if (!(await listSessionGoals(session.id, cwd)).some(goal => goal.id === goalId)) throw new Error('Goal not found in this session');
          result = await transitionSessionGoal(goalId, String(request.params?.status ?? '') as GoalDefinition['status'], Number(request.params?.expectedVersion), cwd, typeof request.params?.reason === 'string' ? request.params.reason : undefined); break;
        }
        case 'notifications/list': result = await listProjectNotifications(cwd, { ...(request.params?.offset !== undefined ? {offset:request.params.offset as number} : {}), ...(request.params?.limit !== undefined ? {limit:request.params.limit as number} : {}), unreadOnly:request.params?.unreadOnly === true }); break;
        case 'notifications/read': result = await markProjectNotificationsRead(cwd, request.params?.ids as string[], String(request.params?.expectedVersion ?? '')); break;
        case 'project/events': result = await projectEventsAfter(cwd, typeof request.params?.cursor === 'string' ? request.params.cursor : undefined, typeof request.params?.limit === 'number' ? request.params.limit : 100); break;
        case 'project/outbox-recover': result = await (await import('./projectOutbox.js')).recoverProjectOutboxes(cwd); break;
        case 'project/watch':
          stopWatch?.();
          stopWatch = request.params?.enabled === false ? undefined : watchLocalState(projectStateWatchPaths(cwd), async revision => { await publishProjectInvalidation(cwd, 'workspace'); write({ jsonrpc: '2.0', method: 'project/state', params: { revision, refresh: ['plans', 'teams', 'agents', 'reviews', 'tasks', 'inbox'] } }); }, { initial: true, recursive: true, onError: () => write({ jsonrpc: '2.0', method: 'project/state-error', params: { message: 'State refresh failed; reload before deciding. No approval was applied.' } }) });
          result = { watching: Boolean(stopWatch), approvalRequiresExpectedVersion: true, eventReplay: true }; break;
        case 'chat/send': {
          const goal = String(request.params?.goal ?? '');
          const context = typeof request.params?.context === 'string' ? request.params.context.slice(0, 100_000) : '';
          const combined = `${goal}${context ? `\n\nIDE context:\n${context}` : ''}`;
          const agentId = typeof request.params?.agentId === 'string' ? request.params.agentId : undefined;
          if (agentId && !(await listAgents()).some(agent => agent.id === agentId && sameSessionWorkspace(agent.cwd, cwd))) throw new Error('Agent belongs to another workspace');
          const sessionId = typeof request.params?.sessionId === 'string' ? request.params.sessionId : undefined;
          const session = sessionId ? await scopedSession(cwd, sessionId) : undefined;
          if (session && agentId && !(await listAgents()).some(agent => agent.id === agentId && agent.sessionId === session.id)) throw new Error('Agent/session mismatch; refresh the conversation');
          const owner = session && !agentId ? await sessionOwner(session, await listAgents()) : undefined;
          result = agentId
            ? await continueAgent(agentId, combined, { onEvent })
            : owner ? await continueAgent(owner.id, combined, { onEvent })
            : await spawnAgent({ goal: combined, role: String(request.params?.role ?? 'lead'), cwd, config: (await loadPlatform(cwd, config)).config, ...(session ? { sessionId: session.id } : {}), background: false, isolation: 'none', onEvent });
          break;
        }
        case 'agent/run':
          result = await spawnAgent({
            goal: String(request.params?.goal ?? ''),
            role: String(request.params?.role ?? 'ide'),
            cwd,
            config,
            background: true,
            isolation: request.params?.worktree === false ? 'none' : 'worktree',
          });
          break;
        case 'agent/cancel':
          if (!(await listAgents()).some(agent => agent.id === String(request.params?.id ?? '') && sameSessionWorkspace(agent.cwd, cwd))) throw new Error('Agent belongs to another workspace');
          result = await cancelAgent(String(request.params?.id ?? ''));
          break;
        case 'agents/list':
          result = (await listAgents()).filter(agent => sameSessionWorkspace(agent.cwd, cwd)).map(({ id, goal, role, status, updatedAt, result: summary, sessionId }) => ({ id, goal, role, status, updatedAt, summary, sessionId }));
          break;
        case 'teams/list': {
          const normalized = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
          result = (await listTeams()).filter(team => team.cwd && normalized(team.cwd) === normalized(cwd)); break;
        }
        case 'sessions/list':
          result = (await listSessions()).filter(session => sameSessionWorkspace(session.cwd, cwd)).map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
          break;
        case 'ide/review/list':
          result = await listIdeConversationState(cwd);
          break;
        case 'plan/list':
          result = await listPlanRecords(cwd);
          break;
        case 'plan/show':
          result = await loadProjectPlan(cwd, String(request.params?.id ?? ''));
          break;
        case 'plan/create':
          result = await createProjectPlan({ cwd, request: String(request.params?.request ?? 'IDE plan'), content: String(request.params?.content ?? ''), ...(typeof request.params?.sessionId === 'string' ? { sessionId: request.params.sessionId } : {}), ...(typeof request.params?.agentId === 'string' ? { planningAgentId: request.params.agentId } : {}) });
          break;
        case 'plan/decide': {
          const decision = request.params?.decision;
          if (!['approved', 'changes_requested', 'rejected', 'cancelled'].includes(String(decision))) throw new Error('Plan decision must be approved, changes_requested, rejected, or cancelled');
          const expectedVersion = request.params?.expectedVersion;
          if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 1) throw new Error('Read plan/show first and provide expectedVersion for an approval decision');
          result = await transitionProjectPlan(cwd, String(request.params?.id ?? ''), decision as 'approved' | 'changes_requested' | 'rejected' | 'cancelled', { expectedVersion: Number(expectedVersion), ...(typeof request.params?.comment === 'string' ? { comment: request.params.comment } : {}) });
          break;
        }
        case 'plan/execute':
          result = await executeProjectPlan({ cwd, planId: String(request.params?.id ?? ''), background: request.params?.background !== false, onEvent });
          break;
        case 'plan/recover':
          result = await recoverProjectPlanExecution(cwd, String(request.params?.id ?? ''));
          break;
        case 'ide/plan/create':
          result = await createIdePlanReview(String(request.params?.sessionId ?? ''), String(request.params?.plan ?? ''), cwd);
          break;
        case 'ide/plan/decide':
          if (!['approved', 'changes-requested'].includes(String(request.params?.decision))) throw new Error('Invalid IDE plan decision');
          result = await decideIdePlanReview(String(request.params?.id ?? ''), request.params?.decision as 'approved' | 'changes-requested', typeof request.params?.comment === 'string' ? request.params.comment : undefined, cwd);
          break;
        case 'ide/edit/create':
          result = await createIdeEditProposal({ sessionId: String(request.params?.sessionId ?? ''), path: String(request.params?.path ?? ''), before: String(request.params?.before ?? ''), after: String(request.params?.after ?? '') }, cwd);
          break;
        case 'ide/edit/decide':
          if (!['accepted', 'rejected'].includes(String(request.params?.decision))) throw new Error('Invalid IDE edit decision');
          result = await decideIdeEditProposal(String(request.params?.id ?? ''), request.params?.decision as 'accepted' | 'rejected', cwd);
          break;
        case 'session/resume': {
          const session = await scopedSession(cwd, String(request.params?.id ?? ''));
          const owner = await sessionOwner(session, await listAgents());
          const goal = String(request.params?.goal ?? 'Continue the saved session.');
          result = owner ? await continueAgent(owner.id, goal, { onEvent }) : await spawnAgent({ goal, role: 'lead', cwd, config: (await loadPlatform(cwd)).config, sessionId: session.id, background: false, isolation: 'none', onEvent });
          break;
        }
        case 'platform/status': {
          const platform = await loadPlatform(cwd, config);
          result = { plugins: platform.plugins.length, skills: platform.skills.length, agents: platform.agents.length, mcpServers: Object.keys(platform.config.mcpServers).length, diagnostics: platform.diagnostics };
          break;
        }
        default:
          throw new Error(`Unknown IDE bridge method: ${request.method ?? '(missing)'}`);
      }
      write({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) {
      write({ jsonrpc: '2.0', id: request.id, error: { message: String(error) } });
    }
  }
  } finally { stopWatch?.(); input.close(); }
}
