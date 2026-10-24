import type { McpServerConfig } from '../../types.js';
export function buildManagedMcpProxy(id: string, url: string): McpServerConfig { if (!id) throw new Error('Managed MCP proxy ID is required'); return { transport: 'http', url: new URL(url).href }; }
