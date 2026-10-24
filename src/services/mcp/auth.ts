import { join } from 'node:path'; import { homeStateDir } from '../../paths.js'; import { readJson, writeJson } from '../../storage.js';
export interface McpAuthToken { accessToken: string; refreshToken?: string; expiresAt?: number; tokenType: string }
const path = () => join(homeStateDir(), 'mcp-auth.json');
export async function saveMcpAuthToken(server: string, token: McpAuthToken): Promise<void> { const values = await readJson<Record<string, McpAuthToken>>(path(), {}); values[server] = token; await writeJson(path(), values); }
export async function loadMcpAuthToken(server: string): Promise<McpAuthToken | undefined> { return (await readJson<Record<string, McpAuthToken>>(path(), {}))[server]; }
