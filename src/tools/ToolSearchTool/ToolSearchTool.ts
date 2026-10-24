import type { ToolDefinition } from '../../types.js';
import { buildTool, ToolRegistry } from '../../Tool.js';

export const ToolSearchTool: ToolDefinition = buildTool({
  name: 'tool_search',
  description: 'Search the active tool catalog by name and capability. Prefix required keywords with + or use select:tool_name.',
  input_schema: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number' } }, required: ['query'] },
});

export function searchToolCatalog(definitions: ToolDefinition[], query: string, maxResults = 5): ReturnType<ToolRegistry['search']> {
  return new ToolRegistry(definitions).search(query, maxResults);
}
