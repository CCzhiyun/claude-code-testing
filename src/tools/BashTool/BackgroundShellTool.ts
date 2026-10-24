import type { ToolDefinition } from '../../types.js';
import { buildTool } from '../../Tool.js';

export const BackgroundShellTool: ToolDefinition = buildTool({
  name: 'shell_start',
  description: 'Start an allowlisted executable as a durable background shell task. Use task_output to monitor and task_stop to cancel.',
  input_schema: { type: 'object', properties: { command: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } }, required: ['command'] },
});
