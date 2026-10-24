import { createTask } from '../../tasks.js'; import type { ToolContext, ToolDefinition } from '../../types.js'; import { TODO_WRITE_TOOL_NAME } from './constants.js'; import { TODO_WRITE_DESCRIPTION } from './prompt.js';
export const TodoWriteTool: ToolDefinition = {
  name: TODO_WRITE_TOOL_NAME, description: TODO_WRITE_DESCRIPTION,
  input_schema: { type: 'object', properties: { todos: { type: 'array', maxItems: 100,
    items: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, dependsOnPrevious: { type: 'boolean' } }, required: ['title'], additionalProperties: false },
  } }, required: ['todos'] },
};
export async function executeTodoWrite(input: { todos: Array<{ title: string; description?: string; dependsOnPrevious?: boolean }> }, context: ToolContext) { const output = []; let previous: string | undefined; for (const todo of input.todos.slice(0, 100)) { const task = await createTask({ teamSessionId: context.teamSessionId ?? context.sessionId, title: todo.title, ...(todo.description ? { description: todo.description } : {}), ...(todo.dependsOnPrevious && previous ? { dependencies: [previous] } : {}) }); output.push(task); previous = task.id; } return output; }
