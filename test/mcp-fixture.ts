import { createInterface } from 'node:readline';

const input = createInterface({ input: process.stdin });
for await (const line of input) {
  const message = JSON.parse(line) as { id?: number; method: string; params?: unknown };
  if (message.id !== undefined) {
    const result = message.method === 'initialize'
      ? { protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: 'fixture', version: '1' } }
      : message.method === 'resources/list'
        ? { resources: [{ uri: 'fixture://guide', name: 'Guide', mimeType: 'text/plain' }] }
        : message.method === 'resources/read'
          ? { contents: [{ uri: 'fixture://guide', mimeType: 'text/plain', text: 'resource body' }] }
          : message.method === 'prompts/list'
            ? { prompts: [{ name: 'review', description: 'Review code' }] }
            : message.method === 'prompts/get'
              ? { description: 'Review code', messages: [{ role: 'user', content: { type: 'text', text: 'review this' } }] }
              : { content: [{ type: 'text', text: 'ok' }] };
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`);
  } else if (message.method === 'notifications/initialized') {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { ready: true } })}\n`);
  }
}
