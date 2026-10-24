import type { ToolDefinition, PlatformConfig } from '../../types.js';
import { buildTool } from '../../Tool.js';
import { loginMcp, logoutMcp } from '../../mcp.js';
export type McpAuthOutput = { server: string; authenticated: boolean };
export function createMcpAuthTool(): ToolDefinition {
  return buildTool({ name: 'mcp_auth', description: 'Store or remove an MCP bearer token without exposing it in tool output.', input_schema: { type: 'object', properties: { server: { type: 'string' }, action: { type: 'string', enum: ['login', 'logout'] }, token: { type: 'string' } }, required: ['server', 'action'] } });
}
export async function executeMcpAuth(input: { server: string; action: 'login' | 'logout'; token?: string }, config?: PlatformConfig): Promise<McpAuthOutput> {
  if (config?.policy.mode === 'restricted') throw new Error('Credential changes are disabled in restricted mode');
  if (input.action === 'login') {
    if (!input.token) throw new Error('Token is required');
    await loginMcp(input.server, input.token, config);
    return { server: input.server, authenticated: true };
  }
  await logoutMcp(input.server, config);
  return { server: input.server, authenticated: false };
}
