import { resolve } from 'node:path';
import { protectPath } from '../../policy.js';
import { NonTextFileError, positiveLimit, readUtf8Text, TextFileLimitError } from '../../textFiles.js';
import type { ToolContext, ToolDefinition } from '../../types.js';
import { executeGlob } from '../GlobTool/GlobTool.js';
import { GREP_DESCRIPTION, GREP_TOOL_NAME } from './prompt.js';
import { BoundedRegexMatcher } from '../../regexWorker.js';
export interface GrepMatch { path: string; line: number; text: string }
export const GrepTool: ToolDefinition = { name: GREP_TOOL_NAME, description: GREP_DESCRIPTION, input_schema: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' }, glob: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } };
export async function executeGrep(input: { query: string; path?: string; glob?: string; limit?: number }, context: ToolContext): Promise<GrepMatch[]> {
  if (input.query.length > 1_000) throw new Error('Search expression is too long');
  const limit = positiveLimit(input.limit, 1_000, 10_000);
  const root = protectPath(resolve(context.cwd, input.path ?? '.'), context.config);
  const deadline = Date.now() + 10_000;
  const paths = await executeGlob({ pattern: input.glob ?? '**/*', ...(input.path ? { path: input.path } : {}), limit: 10_000 }, context, { deadlineAt: deadline });
  const output: GrepMatch[] = [];
  const matcher = new BoundedRegexMatcher(input.query);
  try {
  for (const path of paths) {
    if (Date.now() > deadline) throw new Error('Search exceeded its total execution time limit');
    let content: string;
    try { content = await readUtf8Text(protectPath(resolve(root, path), context.config), 1_000_000); }
    catch (error) { if (error instanceof NonTextFileError || error instanceof TextFileLimitError) continue; throw error; }
    for (const match of await matcher.match(content, limit - output.length)) {
      output.push({ path, ...match });
      if (output.length >= limit) return output;
    }
  }
  return output;
  } finally { await matcher.close(); }
}
