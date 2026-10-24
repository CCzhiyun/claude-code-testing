import type { ToolDefinition } from '../../types.js';
import { buildTool } from '../../Tool.js';

export const ListMcpPromptsTool: ToolDefinition = buildTool({
  name: 'mcp_prompts_list',
  description: 'List reusable prompt templates exposed by configured MCP servers.',
  input_schema: { type: 'object', properties: { server: { type: 'string' } } },
});

export const GetMcpPromptTool: ToolDefinition = buildTool({
  name: 'mcp_prompt_get',
  description: 'Render a prompt template from a configured MCP server.',
  input_schema: { type: 'object', properties: { server: { type: 'string' }, prompt: { type: 'string' }, arguments: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['server', 'prompt'] },
});
