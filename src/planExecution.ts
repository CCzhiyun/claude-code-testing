import { continueAgent, listAgents, loadAgent, spawnAgent, waitForAgent } from './agent.js';
import { loadPlatform } from './platform.js';
import { loadProjectPlan, transitionProjectPlan } from './plans.js';
import type { AgentRecord } from './types.js';
import type { RuntimeEventListener } from './runtimeEvents.js';
import { sameSessionWorkspace } from './sessionRecovery.js';
import { applyWorkflowBudget, type WorkflowBudget } from './workflowBudget.js';

function executionPrompt(plan: Awaited<ReturnType<typeof loadProjectPlan>>): string {
  return `Execute the approved project plan ${plan.id}. Work through every applicable step, keep changes within the trusted workspace, run the specified validation, and report concrete completion evidence. If a blocker materially changes the plan, stop and request input instead of guessing.\n\nApproved plan:\n${plan.content}`;
}

export async function executeProjectPlan(options: { cwd: string; planId: string; background?: boolean; onEvent?: RuntimeEventListener; workflowBudget?:WorkflowBudget; feedback?:string }): Promise<AgentRecord> {
  const plan = await loadProjectPlan(options.cwd, options.planId);
  if (!['approved', 'blocked', 'failed'].includes(plan.status)) throw new Error(`Plan ${plan.id} must be approved or resumable before execution (current: ${plan.status})`);
  const platform = await loadPlatform(options.cwd);
  if(options.workflowBudget) platform.config=applyWorkflowBudget(platform.config,options.workflowBudget);
  const executorId = plan.executionAgentId ?? plan.planningAgentId;
  if (executorId) {
    const executor = await loadAgent(executorId);
    if (['queued', 'working'].includes(executor.status)) throw new Error(`Execution Agent ${executor.id} is still active`);
  }
  const reserved = await transitionProjectPlan(options.cwd, plan.id, 'executing', { expectedVersion: plan.version, ...(executorId ? { executionAgentId: executorId } : {}) });
  let record: AgentRecord;
  try {
    if (executorId) {
      record = await continueAgent(executorId, executionPrompt(plan)+(options.feedback ? `\n\nExplicit human continuation feedback:\n${options.feedback}` : ''), {
        background: true,
        config: platform.config,
        planId: plan.id,
        ...(options.workflowBudget ? {workflowBudget:options.workflowBudget} : {}),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
    } else {
      record = await spawnAgent({
        goal: executionPrompt(plan),
        cwd: options.cwd,
        config: platform.config,
        role: 'lead',
        isolation: platform.config.agents.defaultIsolation,
        background: true,
        planId: plan.id,
        ...(options.workflowBudget && plan.sessionId ? {sessionId:plan.sessionId} : {}),
        ...(options.workflowBudget ? {workflowBudget:options.workflowBudget} : {}),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      });
    }
  } catch (error) {
    // Only undo our unchanged launch reservation. A launched worker owns its outcome;
    // a late launcher error must not overwrite cancellation or another attempt.
    const current = await loadProjectPlan(options.cwd, plan.id);
    if (current.status === 'executing' && current.version === reserved.version && current.executionAgentId === reserved.executionAgentId) {
      await transitionProjectPlan(options.cwd, plan.id, 'failed', { expectedVersion: reserved.version, error: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  }
  // A caller timing out while waiting is not evidence that execution failed.
  return options.background === false ? waitForAgent(record.id) : record;
}

/** Inspect a stranded execution without ever launching/replaying work. */
export async function recoverProjectPlanExecution(cwd: string, planId: string) {
  const plan = await loadProjectPlan(cwd, planId);
  if (plan.status !== 'executing') return plan;
  // Refresh dead worker records using the normal heartbeat/liveness rules.
  const agents = await listAgents();
  const owner = agents.find(agent => agent.id === plan.executionAgentId && agent.planId === plan.id && sameSessionWorkspace(agent.cwd, cwd));
  if (owner && ['queued', 'working'].includes(owner.status)) return loadProjectPlan(cwd, planId);
  const status = owner?.status === 'completed' ? 'completed' : owner?.status === 'cancelled' ? 'cancelled' : owner?.status === 'failed' ? 'failed' : 'blocked';
  return transitionProjectPlan(cwd, planId, status, {
    expectedVersion: plan.version,
    ...(plan.executionAgentId ? { expectedExecutionAgentId: plan.executionAgentId } : {}),
    ...(status === 'completed' ? {} : { error: owner?.error ?? 'Execution interrupted or awaiting input. No work was replayed; inspect the Agent/session before explicitly continuing.' }),
  });
}
