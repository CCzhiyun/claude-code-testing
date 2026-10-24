const planSessions = new Set<string>();
const worktrees = new Map<string, { repo: string; path: string }>();
export function enterPlanMode(sessionId: string): void { planSessions.add(sessionId); }
export function exitPlanMode(sessionId: string): void { planSessions.delete(sessionId); }
export function isPlanMode(sessionId: string): boolean { return planSessions.has(sessionId); }
export function setSessionWorktree(sessionId: string, repo: string, path: string): void { worktrees.set(sessionId, { repo, path }); }
export function getSessionWorktree(sessionId: string): { repo: string; path: string } | undefined { return worktrees.get(sessionId); }
export function clearSessionWorktree(sessionId: string): void { worktrees.delete(sessionId); }
