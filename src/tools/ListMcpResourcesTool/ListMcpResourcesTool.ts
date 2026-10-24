import type { ToolDefinition } from '../../types.js';
import { buildTool } from '../../Tool.js';

export const ListMcpResourcesTool: ToolDefinition = buildTool({
  name: 'mcp_resources_list',
  description: 'List resources exposed by configured MCP servers, optionally filtered by server name.',
  input_schema: { type: 'object', properties: { server: { type: 'string' } } },
});
