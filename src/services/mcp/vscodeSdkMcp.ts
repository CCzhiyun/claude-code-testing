import type { McpServerConfig } from '../../types.js';
export function vscodeMcpConfig(port: number, tokenEnvironment = 'CCPT_IDE_TOKEN'): McpServerConfig { if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid IDE MCP port'); return { transport: 'http', url: `http://127.0.0.1:${port}/mcp`, tokenEnv: tokenEnvironment }; }
