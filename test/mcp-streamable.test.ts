import { expect, test } from 'bun:test';
import { defaultConfig } from '../src/config.js';
import { decodeMcpResponse, inspectMcpServer, listMcpPrompts, listMcpResources, requestMcpServer, StdioMcpClient } from '../src/mcp.js';
import { networkRequest } from '../src/network.js';

test('Streamable HTTP initializes, sends session/version headers, paginates each catalog in one session and closes', async () => {
  const methods: string[] = []; const headers: Array<[string | null, string | null]> = []; let closed = 0;
  const server = Bun.serve({ port: 0, async fetch(request) {
    if (request.method === 'DELETE') { closed++; return new Response(null, { status: 204 }); }
    const rpc = await request.json() as { id?: number; method: string; params: { cursor?: string } };
    methods.push(rpc.method);
    if (rpc.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-06-18', capabilities: {} } }, { headers: { 'mcp-session-id': 'test-session' } });
    headers.push([request.headers.get('mcp-session-id'), request.headers.get('mcp-protocol-version')]);
    if (rpc.method === 'notifications/initialized') { expect(rpc.id).toBeUndefined(); return new Response(null, { status: 202 }); }
    const field = rpc.method.split('/')[0]!;
    const result = { [field]: [{ name: rpc.params.cursor ? 'second' : 'first', uri: `fixture://${rpc.params.cursor ?? 'first'}` }], ...(!rpc.params.cursor ? { nextCursor: 'page2' } : {}) };
    return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const config = structuredClone(defaultConfig); config.hooks = [];
    const remote = { transport: 'http' as const, httpMode: 'streamable' as const, url: `http://127.0.0.1:${server.port}/mcp` };
    config.mcpServers = { streamable_fixture: remote };
    expect((await inspectMcpServer('streamable_fixture', remote, config) as { tools: unknown[] }).tools).toHaveLength(2);
    expect(await listMcpResources(config)).toHaveLength(2);
    expect(await listMcpPrompts(config)).toHaveLength(2);
    expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'initialize', 'notifications/initialized', 'resources/list', 'resources/list', 'initialize', 'notifications/initialized', 'prompts/list', 'prompts/list']);
    expect(headers.every(([session, version]) => session === 'test-session' && version === '2025-06-18')).toBe(true); expect(closed).toBe(3);
  } finally { server.stop(true); }
});

test('JSON-RPC decoder distinguishes notifications, matching replies, RPC failures and missing/duplicate replies', () => {
  const events: unknown[] = [];
  const sse = ['data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":1}}', '', 'data: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}', ''].join('\n');
  expect(decodeMcpResponse(sse, 'text/event-stream', 2, event => events.push(event))).toEqual({ ok: true }); expect(events).toHaveLength(1);
  expect(() => decodeMcpResponse('{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"denied"}}', 'application/json', 2)).toThrow('denied');
  expect(() => decodeMcpResponse('{"jsonrpc":"2.0","id":2,"error":{"message":"missing mandatory code"}}', 'application/json', 2)).toThrow('Invalid MCP error envelope');
  expect(() => decodeMcpResponse('{"jsonrpc":"2.0","id":1,"result":{}}', 'application/json', 2)).toThrow('requested ID');
  expect(() => decodeMcpResponse(`${sse}\n${sse}`, 'text/event-stream', 2)).toThrow('Duplicate');
  expect(() => decodeMcpResponse('{"tools":[]}', 'application/json', 2)).toThrow();
  expect(decodeMcpResponse('{"tools":[]}', 'application/json', 2, undefined, true)).toEqual({ tools: [] });
});

test('expired session never replays a tool call and still attempts cleanup', async () => {
  let calls = 0; let initialized = 0; let closed = 0;
  const server = Bun.serve({ port: 0, async fetch(request) {
    if (request.method === 'DELETE') { closed++; return new Response(null, { status: 405 }); }
    const rpc = await request.json() as { id?: number; method: string };
    if (rpc.method === 'initialize') { initialized++; return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-06-18' } }, { headers: { 'mcp-session-id': 'expired' } }); }
    if (rpc.method === 'notifications/initialized') return new Response(null, { status: 202 });
    calls++; return new Response('session expired', { status: 404 });
  } });
  try {
    const config = structuredClone(defaultConfig); config.hooks = [];
    await expect(requestMcpServer('expiry_fixture', { transport: 'http', httpMode: 'streamable', url: `http://127.0.0.1:${server.port}` }, 'tools/call', { name: 'mutate' }, true, undefined, config)).rejects.toThrow('no automatic tool replay');
    expect(calls).toBe(1); expect(initialized).toBe(1); expect(closed).toBe(1);
  } finally { server.stop(true); }
});

test('repeated pagination cursor fails fast and direct mode remains initialization-free', async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, async fetch(request) {
    const rpc = await request.json() as { id: number; method: string };
    expect(rpc.method).toBe('tools/list'); calls++;
    return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { tools: [], nextCursor: 'repeat' } });
  } });
  try {
    const config = structuredClone(defaultConfig); config.hooks = [];
    await expect(inspectMcpServer('paging_fixture', { transport: 'http', url: `http://127.0.0.1:${server.port}` }, config)).rejects.toThrow('pagination cursor'); expect(calls).toBe(2);
  } finally { server.stop(true); }
});

test('network size and absolute deadline limits reject unbounded HTTP responses', async () => {
  const server = Bun.serve({ port: 0, fetch(request) {
    if (new URL(request.url).pathname === '/big') return new Response('x'.repeat(8192));
    let timer: ReturnType<typeof setInterval>;
    return new Response(new ReadableStream({ start(controller) { timer = setInterval(() => { try { controller.enqueue(new TextEncoder().encode('data: ping\n\n')); } catch { clearInterval(timer); } }, 15); }, cancel() { clearInterval(timer); } }));
  } });
  try {
    const config = structuredClone(defaultConfig.network); config.timeoutMs = 3000;
    await expect(networkRequest(`http://127.0.0.1:${server.port}/big`, { maxResponseBytes: 1024 }, config)).rejects.toThrow();
    const start = Date.now();
    await expect(networkRequest(`http://127.0.0.1:${server.port}/endless`, { deadlineMs: 120 }, config)).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2000);
  } finally { server.stop(true); }
});

test('missing stdio executable rejects initialization without crashing or waiting thirty seconds', async () => {
  const client = new StdioMcpClient();
  try { await expect(client.connect({ transport: 'stdio', command: 'ccpt-missing-test-executable-923823' })).rejects.toThrow(); }
  finally { await client.close(); }
});
