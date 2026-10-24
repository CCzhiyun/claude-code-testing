import type { MCPServerConnection } from './types.js';
export const connectedMcpServers = (connections: MCPServerConnection[]): MCPServerConnection[] => connections.filter((connection) => connection.type === 'connected');
export function mcpConnectionSummary(connection: MCPServerConnection): string { return connection.type === 'failed' ? `${connection.name}: failed — ${connection.error ?? 'unknown error'}` : `${connection.name}: ${connection.type}`; }
