import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { StdioMcpClient } from '../src/mcp.js';
import { defaultConfig } from '../src/config.js';
import { tmpdir } from 'node:os';

describe('bidirectional MCP stdio client', () => {
  test('initializes, receives notifications, and calls a tool', async () => {
    const client = new StdioMcpClient();
    const notifications: unknown[] = [];
    client.on('notification', (message) => notifications.push(message));
    await client.connect({ transport: 'stdio', command: process.execPath, args: [join(import.meta.dir, 'mcp-fixture.ts')] });
    const result = await client.request('tools/call', { name: 'fixture', arguments: {} });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.close();
    expect(JSON.stringify(result)).toContain('ok');
    expect(notifications.length).toBeGreaterThan(0);
  });

  test('rejects an MCP working directory outside enterprise workspace roots', async () => {
    const client = new StdioMcpClient();
    const config = structuredClone(defaultConfig);
    config.policy.workspaceRoots = [import.meta.dir];
    await expect(client.connect({ transport: 'stdio', command: process.execPath, args: [join(import.meta.dir, 'mcp-fixture.ts')], cwd: tmpdir() }, undefined, config)).rejects.toThrow('outside permitted workspace');
  });
});
