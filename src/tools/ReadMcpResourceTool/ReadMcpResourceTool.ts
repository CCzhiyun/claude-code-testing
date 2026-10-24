import type { ToolDefinition } from '../../types.js';
import { buildTool } from '../../Tool.js';

export const ReadMcpResourceTool: ToolDefinition = buildTool({
  name: 'mcp_resource_read',
  description: 'Read a specific MCP resource by server name and resource URI.',
  input_schema: { type: 'object', properties: { server: { type: 'string' }, uri: { type: 'string' } }, required: ['server', 'uri'] },
});
