import { readFile, writeFile } from 'node:fs/promises';
import { resolveWorkspacePath } from '../../paths.js';
import { protectPath } from '../../policy.js';
import type { ToolContext, ToolDefinition } from '../../types.js';
import { FILE_EDIT_TOOL_NAME } from './constants.js';
import { FILE_EDIT_DESCRIPTION } from './prompt.js';
import type { FileEditInput, FileEditResult } from './types.js';
import { applyExactEdit } from './utils.js';
import { notifyLifecycle } from '../../lifecycleNotifications.js';
export const FileEditTool: ToolDefinition = { name: FILE_EDIT_TOOL_NAME, description: FILE_EDIT_DESCRIPTION, input_schema: { type: 'object', properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' }, replaceAll: { type: 'boolean' } }, required: ['path', 'oldText', 'newText'] } };
export async function executeFileEdit(input: FileEditInput, context: ToolContext): Promise<FileEditResult> {
  if (context.config.policy.mode === 'restricted') throw new Error('File edits are disabled in restricted mode');
  const path = protectPath(resolveWorkspacePath(context.cwd, input.path, context.config.policy.workspaceRoots), context.config);
  const original = await readFile(path, 'utf8');
  const edited = applyExactEdit(original, input.oldText, input.newText, input.replaceAll);
  await writeFile(path, edited.content, { mode: 0o600 });
  await notifyLifecycle(context.config, context.cwd, 'FileChanged', { path, change:'modified', tool:'edit_file', agentId:context.agentId, sessionId:context.sessionId });
  return { path, replacements: edited.replacements, linesAdded: input.newText.split(/\r?\n/).length - 1, linesRemoved: input.oldText.split(/\r?\n/).length - 1 };
}
