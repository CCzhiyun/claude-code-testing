import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveWorkspacePath } from '../../paths.js';
import { protectPath } from '../../policy.js';
import type { ToolContext, ToolDefinition } from '../../types.js';
import { FILE_WRITE_DESCRIPTION, FILE_WRITE_TOOL_NAME } from './prompt.js';
export const FileWriteTool: ToolDefinition = { name: FILE_WRITE_TOOL_NAME, description: FILE_WRITE_DESCRIPTION, input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } };
export async function executeFileWrite(input: { path: string; content: string }, context: ToolContext): Promise<{ path: string; bytes: number }> { if (context.config.policy.mode === 'restricted') throw new Error('File writes are disabled in restricted mode'); const path = protectPath(resolveWorkspacePath(context.cwd, input.path, context.config.policy.workspaceRoots), context.config); await mkdir(dirname(path), { recursive: true }); await writeFile(path, input.content, { mode: 0o600 }); return { path, bytes: Buffer.byteLength(input.content) }; }
