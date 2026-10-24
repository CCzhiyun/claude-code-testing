import type { ToolContext, ToolDefinition } from '../../types.js'; import { buildTool } from '../../Tool.js'; import { enterPlanMode } from '../modeState.js';
export type Output = { planMode: true };
export function executeEnterPlanMode(context: ToolContext): Output { enterPlanMode(context.sessionId); return { planMode: true }; }
export const EnterPlanModeTool: ToolDefinition = buildTool({ name: 'enter_plan_mode', description: 'Enter session-scoped read-only planning mode.', input_schema: { type: 'object', properties: {} } });
