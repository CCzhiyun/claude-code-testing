export interface ProductLesson { id: string; title: string; objective: string; steps: string[]; command?: string; audience: 'new-user' | 'developer' | 'lead' | 'admin' }
export interface CommunicationKit { launchMessage: string; championChecklist: string[]; successMetrics: string[]; supportRunbook: string[] }

export const PRODUCT_LESSONS: readonly ProductLesson[] = [
  { id: 'first-run', title: 'Start a governed coding session', objective: 'Initialize a project and verify its policy boundary.', steps: ['Run the doctor', 'Initialize .ccpt', 'Review workspace roots and permission mode'], command: '/doctor', audience: 'new-user' },
  { id: 'context', title: 'Control context deliberately', objective: 'Inspect, compact, branch, and restore session context.', steps: ['Inspect /context', 'Create a checkpoint', 'Compact only after reviewing retained context'], command: '/context', audience: 'developer' },
  { id: 'parallel', title: 'Delegate safely', objective: 'Split independent work across bounded Agents.', steps: ['Create a plan', 'Choose shared or worktree isolation', 'Wait for validation before integration'], command: '/ultraplan', audience: 'lead' },
  { id: 'governance', title: 'Operate enterprise controls', objective: 'Apply managed policy, audit, retention, and integration health.', steps: ['Review managed settings', 'Inspect adapter health', 'Export audit and usage evidence'], command: '/privacy-settings', audience: 'admin' },
];

export function lessonsForAudience(audience: ProductLesson['audience']): ProductLesson[] {
  const rank: ProductLesson['audience'][] = ['new-user', 'developer', 'lead', 'admin'];
  return PRODUCT_LESSONS.filter((lesson) => rank.indexOf(lesson.audience) <= rank.indexOf(audience));
}

export function createCommunicationKit(productName = 'CCPT'): CommunicationKit {
  return {
    launchMessage: `${productName} is available for governed Agentic development. Start with /doctor, confirm the active permission mode, and use /help for native workflows.`,
    championChecklist: ['Publish approved model and policy settings', 'Nominate engineering champions', 'Run a pilot repository', 'Review audit, usage, and feedback weekly', 'Document escalation and external adapter ownership'],
    successMetrics: ['Active developers and retained weekly users', 'Validated tasks completed', 'Review findings resolved', 'Median cycle time', 'Policy denials and approval latency', 'Cost per completed task'],
    supportRunbook: ['Capture /doctor and /status output', 'Confirm model and network reachability', 'Inspect managed policy precedence', 'Check external surface health', 'Collect redacted audit events', 'Escalate with reproducible session and checkpoint ids'],
  };
}
