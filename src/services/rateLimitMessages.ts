export interface RateLimitState { status: 'allowed' | 'warning' | 'rejected'; resetsAt?: number; utilization?: number; type?: string }
export function getRateLimitWarning(state: RateLimitState): string | undefined { if (state.status === 'allowed') return undefined; const reset = state.resetsAt ? `，预计 ${new Date(state.resetsAt * 1_000).toLocaleString()} 重置` : ''; return state.status === 'rejected' ? `请求额度已用尽${reset}` : `请求额度接近上限${state.utilization !== undefined ? `（${Math.round(state.utilization * 100)}%）` : ''}${reset}`; }
export const getRateLimitErrorMessage = (state: RateLimitState): string => getRateLimitWarning({ ...state, status: 'rejected' })!;
export const getUsingOverageText = (): string => '当前请求正在使用已配置的额外额度。';
