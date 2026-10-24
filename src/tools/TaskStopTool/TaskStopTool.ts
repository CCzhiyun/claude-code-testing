import type { ToolDefinition } from '../../types.js';
import { buildTool } from '../../Tool.js';

export const TaskStopTool: ToolDefinition = buildTool({
  name: 'task_stop',
  description: 'Stop a running background shell task and persist its cancelled state.',
  input_schema: { type: 'object', properties: { task_id: { type: 'string' } }, required: ['task_id'] },
});
