import { getRuntimeState } from '../bootstrap/state.js';
export interface QueryConfig { sessionId: string; gates: { streamingToolExecution: boolean; emitToolUseSummaries: boolean; fastModeEnabled: boolean } }
const truthy = (value: string | undefined) => value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
export function buildQueryConfig(sessionId = `local:${getRuntimeState().startedAt}`): QueryConfig {
  return { sessionId, gates: { streamingToolExecution: !truthy(process.env.CCPT_DISABLE_STREAMING_TOOLS), emitToolUseSummaries: truthy(process.env.CCPT_EMIT_TOOL_USE_SUMMARIES), fastModeEnabled: !truthy(process.env.CCPT_DISABLE_FAST_MODE) } };
}
