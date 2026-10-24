import { positiveLimit, readUtf8Text } from '../../textFiles.js';
import { resolveWorkspacePath } from '../../paths.js';
import { protectPath } from '../../policy.js';
import type { ToolContext, ToolDefinition } from '../../types.js';
import { DEFAULT_MAX_READ_LINES, MAX_LINE_LENGTH, MAX_READ_BYTES } from './limits.js';
import { FILE_READ_DESCRIPTION, FILE_READ_TOOL_NAME } from './prompt.js';
export const FileReadTool: ToolDefinition = { name: FILE_READ_TOOL_NAME, description: FILE_READ_DESCRIPTION, input_schema: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'number' }, limit: { type: 'number' } }, required: ['path'] } };
export async function executeFileRead(input: { path: string; offset?: number; limit?: number }, context: ToolContext): Promise<{ content: string; totalLines: number; truncated: boolean }> {
  const path = protectPath(resolveWorkspacePath(context.cwd, input.path, context.config.policy.workspaceRoots), context.config);
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset must be a non-negative safe integer');
  const limit = positiveLimit(input.limit, DEFAULT_MAX_READ_LINES, DEFAULT_MAX_READ_LINES);
  const lines = (await readUtf8Text(path, MAX_READ_BYTES)).split(/\r?\n/);
  const selected = lines.slice(offset, offset + limit).map(line => line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…` : line);
  return { content: selected.map((line, index) => `${offset + index + 1}\t${line}`).join('\n'), totalLines: lines.length, truncated: offset + limit < lines.length };
}
