import type { ToolDefinition } from '../types.js';

const coordinatorTools = new Set(['delegate', 'agent_status', 'wait_agent', 'task_list', 'task_create', 'task_update', 'task_claim', 'team_discover', 'team_send', 'team_inbox', 'list_files', 'read_file', 'search_text', 'memory_list', 'memory_read', 'checkpoint_list', 'mcp_call', 'mcp_resources_list', 'mcp_resource_read', 'mcp_prompts_list', 'mcp_prompt_get', 'tool_search', 'ask_user']);

export function isCoordinatorMode(enabled: boolean, depth: number): boolean { return enabled && depth === 0; }
export function coordinatorToolCatalog(tools: ToolDefinition[]): ToolDefinition[] { return tools.filter((tool) => coordinatorTools.has(tool.name)); }
export function getCoordinatorSystemPrompt(): string {
  return `You are operating as the lead coordinator. Break substantive independent work into persistent tasks, delegate it to workers, monitor results, and synthesize evidence for the user. Do not perform code edits or shell execution yourself; workers own implementation and verification. Read enough context to write self-contained worker directives, avoid duplicate assignments, and use the durable mailbox for follow-up.`;
}
export function getCoordinatorUserContext(mcpServerNames: string[]): Record<string, string> {
  return { workerToolsContext: `Workers inherit standard CCPT coding tools${mcpServerNames.length ? ` and MCP servers: ${mcpServerNames.join(', ')}` : ''}.` };
}
