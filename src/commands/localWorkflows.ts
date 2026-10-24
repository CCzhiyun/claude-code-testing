import type { RegisteredCommand } from '../platform.js';

const workflow = (name: string, description: string, prompt: string, isolation: 'none' | 'worktree' = 'none'): RegisteredCommand => ({ name: `/${name}`, description, prompt, plugin: 'native-workflows', isolation });

export const LOCAL_WORKFLOW_COMMANDS: readonly RegisteredCommand[] = [
  workflow('advisor', 'Analyze the project and recommend the safest next action', 'Act as a senior engineering advisor. Analyze the current project and the following request, then provide prioritized, evidence-backed guidance. Do not modify files unless explicitly asked. Request: {args}'),
  workflow('brief', 'Produce a concise engineering brief', 'Create a concise engineering brief for the current repository and request. Include objective, constraints, affected areas, risks, acceptance criteria, and validation. Request: {args}'),
  workflow('commit', 'Prepare a focused commit from current changes', 'Inspect current changes, run proportionate validation, and prepare a focused commit. Do not push. Use the supplied message guidance if present: {args}'),
  workflow('commit-push-pr', 'Validate, commit, push and prepare a pull request', 'Inspect and validate the current changes, create a focused commit, push only when policy permits, and prepare a pull request summary. Request: {args}'),
  workflow('plan', 'Create an implementation plan without editing files', 'Analyze the repository and produce a concrete implementation plan only. Do not edit files. Request: {args}'),
  workflow('review', 'Review current changes for correctness and risk', 'Review the current changes for correctness, regressions, security, maintainability, and missing tests. Report findings ordered by severity with file evidence. Context: {args}'),
  workflow('security-review', 'Run a security-focused code review', 'Perform a security-focused review of the current repository or requested scope. Check trust boundaries, secrets, injection, SSRF, path traversal, command execution, authorization, and dependency risks. Context: {args}'),
  workflow('summary', 'Summarize the active project and work state', 'Summarize the current project state, relevant recent changes, validation evidence, remaining risks, and concrete next actions. Context: {args}'),
  workflow('ultraplan', 'Build a dependency-aware multi-Agent execution plan', 'Create a dependency-aware execution plan for a larger change. Identify parallel workstreams, ownership boundaries, integration points, risks, and validation gates. Do not edit files. Request: {args}'),
];

export function localWorkflow(name: string): RegisteredCommand | undefined { return LOCAL_WORKFLOW_COMMANDS.find((command) => command.name === (name.startsWith('/') ? name : `/${name}`)); }
