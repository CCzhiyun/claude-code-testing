import { relative, resolve } from 'node:path';
import { protectPath } from '../../policy.js';
import type { ToolContext, ToolDefinition } from '../../types.js';
import { GLOB_DESCRIPTION, GLOB_TOOL_NAME } from './prompt.js';
import { positiveLimit } from '../../textFiles.js';
import { boundedWorkspaceFiles, globMatcher } from '../../boundedWalk.js';
export const GlobTool: ToolDefinition = { name: GLOB_TOOL_NAME, description: GLOB_DESCRIPTION, input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path: { type: 'string' }, limit: { type: 'number' } }, required: ['pattern'] } };
export async function executeGlob(input: { pattern: string; path?: string; limit?: number }, context: ToolContext, options: { deadlineAt?: number } = {}): Promise<string[]> {
  const root = protectPath(resolve(context.cwd, input.path ?? '.'), context.config);
  const limit = positiveLimit(input.limit, 1_000, 10_000);
  if (input.pattern.length > 2_000) throw new Error('Glob pattern is too long');
  const matches = globMatcher(input.pattern);
  return (await boundedWorkspaceFiles(root, context.config, { limit, ...options, accepts: path => matches(relative(root, path).replaceAll('\\', '/')) })).map(path => relative(root, path).replaceAll('\\', '/')).sort();
}
