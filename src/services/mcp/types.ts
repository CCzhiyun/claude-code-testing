import type { McpServerConfig } from '../../types.js';
export type ConfigScope = 'local' | 'user' | 'project' | 'dynamic' | 'enterprise' | 'managed';
export type Transport = 'stdio' | 'sse' | 'http' | 'ws' | 'sdk';
export type ScopedMcpServerConfig = McpServerConfig & { scope: ConfigScope; enabled?: boolean; headers?: Record<string, string>; headersHelper?: string };
export type MCPServerConnection = { name: string; type: 'connected'; config: ScopedMcpServerConfig; capabilities: Record<string, unknown>; cleanup(): Promise<void> } | { name: string; type: 'failed' | 'needs-auth' | 'pending' | 'disabled'; config: ScopedMcpServerConfig; error?: string };
export interface ServerResource { server: string; uri: string; name: string; mimeType?: string }
export interface JsonRpcMessage { jsonrpc: '2.0'; id?: string | number; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } }
