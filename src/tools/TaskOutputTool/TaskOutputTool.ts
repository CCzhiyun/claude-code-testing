import type { ToolDefinition } from '../../types.js';
import { buildTool } from '../../Tool.js';

export const TaskOutputTool: ToolDefinition = buildTool({
  name: 'task_output',
  description: 'Read current stdout, stderr, exit status, and metadata for a background shell task.',
  input_schema: { type: 'object', properties: { task_id: { type: 'string' }, max_chars: { type: 'number' } }, required: ['task_id'] },
});
