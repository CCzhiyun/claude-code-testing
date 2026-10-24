export function normalizeNameForMCP(name: string): string { const normalized = name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, ''); return (normalized || 'mcp').slice(0, 64); }
export const normalizeToolName = (server: string, tool: string): string => `mcp__${normalizeNameForMCP(server)}__${normalizeNameForMCP(tool)}`;
