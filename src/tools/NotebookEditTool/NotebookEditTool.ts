import { editNotebook } from '../../notebooks.js';
import type { ToolContext, ToolDefinition } from '../../types.js';
import { resolveWorkspacePath } from '../../paths.js';
import { NOTEBOOK_EDIT_TOOL_NAME } from './constants.js';
import { NOTEBOOK_EDIT_DESCRIPTION } from './prompt.js';
export const NotebookEditTool: ToolDefinition = { name: NOTEBOOK_EDIT_TOOL_NAME, description: NOTEBOOK_EDIT_DESCRIPTION, input_schema: { type: 'object', properties: { notebook_path: { type: 'string' }, cell_id: { type: 'string' }, source: { type: 'string' }, cell_type: { type: 'string' }, edit_mode: { type: 'string' } }, required: ['notebook_path'] } };
export async function executeNotebookEdit(input: { notebook_path: string; cell_id?: string; source?: string; cell_type?: 'code' | 'markdown'; edit_mode?: 'replace' | 'insert' | 'delete' }, context: ToolContext): Promise<void> { if (context.config.policy.mode === 'restricted') throw new Error('Notebook edits are disabled in restricted mode'); const path = resolveWorkspacePath(context.cwd, input.notebook_path, context.config.policy.workspaceRoots); await editNotebook({ path, ...(input.cell_id ? { cellId: input.cell_id } : {}), ...(input.source !== undefined ? { source: input.source } : {}), ...(input.cell_type ? { cellType: input.cell_type } : {}), mode: input.edit_mode ?? 'replace' }); }
