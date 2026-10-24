export interface InProcessTeammateTaskOptions<T> { id: string; run(signal: AbortSignal): Promise<T> }
export type InProcessTaskState<T> = { status: 'running' } | { status: 'completed'; result: T } | { status: 'failed'; error: string } | { status: 'cancelled' };
