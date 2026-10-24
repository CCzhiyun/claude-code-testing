#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { loadPlatform } from '../platform.js';
import { executeTool, tools } from '../tooling.js';
import { spawnAgent } from '../agent.js';
import type { ToolContext } from '../types.js';

interface JsonRpcRequest { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

function reply(message: unknown): void { process.stdout.write(`${JSON.stringify(message)}\n`); }

async function main(): Promise<void> {
  const cwdIndex = process.argv.indexOf('--cwd');
  const cwd = resolve(cwdIndex >= 0 && process.argv[cwdIndex + 1] ? process.argv[cwdIndex + 1]! : process.cwd());
  const platform = await loadPlatform(cwd);
  const context: ToolContext = { cwd, agentId: 'mcp_host', sessionId: 'mcp_session', teamSessionId: 'mcp_session', depth: 0, config: platform.config };
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    let request: JsonRpcRequest;
    try { request = JSON.parse(line) as JsonRpcRequest; }
    catch { reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    if (!request.method) continue;
    if (request.id === undefined) continue;
    try {
      let result: unknown;
      if (request.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'ccpt', version: '0.34.0' } };
      else if (request.method === 'ping') result = {};
      else if (request.method === 'tools/list') result = { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.input_schema })) };
      else if (request.method === 'tools/call') {
        const name = request.params?.name;
        if (typeof name !== 'string') throw new Error('Tool name is required');
        const input = request.params?.arguments && typeof request.params.arguments === 'object' ? request.params.arguments as Record<string, unknown> : {};
        const output = await executeTool(name, input, context, async (goal, role, isolation, contextMode) => {
          const child = await spawnAgent({ goal, role, isolation, contextMode, cwd, config: platform.config });
          return `Started ${child.id}`;
        });
        result = { content: [{ type: 'text', text: output.content }], isError: false };
      } else throw Object.assign(new Error(`Method not found: ${request.method}`), { code: -32601 });
      reply({ jsonrpc: '2.0', id: request.id, result });
    } catch (error) {
      const value = error as Error & { code?: number };
      reply({ jsonrpc: '2.0', id: request.id, error: { code: value.code ?? -32000, message: value.message } });
    }
  }
}

void main();
