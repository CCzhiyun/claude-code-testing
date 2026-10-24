import { expect, test } from 'bun:test';
import { defaultConfig } from '../src/config.js';
import { requestMcpServer } from '../src/mcp.js';
import { withExecutionSignal } from '../src/executionControl.js';
import type { McpInteractionHandlers } from '../src/mcpInteraction.js';

const sampling = { method: 'sampling/createMessage', params: { messages: [{ role: 'user', content: { type: 'text', text: 'HTTP-SAMPLE-ONLY' } }], maxTokens: 64 } };
const form = { method: 'elicitation/create', params: { message: '选择项目', requestedSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] } } };
const handlers = (): McpInteractionHandlers => ({ confirmSampling: async () => true, sample: async () => ({ role: 'assistant', content: { type: 'text', text: 'HTTP-SAMPLED' }, model: 'fixture' }), confirmSamplingResult: async () => true, elicit: async () => ({ action: 'accept', content: { project: '应用' } }) });
type Options = { requests?: Array<{ method: string; params: unknown }>; early?: boolean; openAfterResult?: boolean; badAck?: boolean; version?: string; rawFrames?: (id: number) => string; splitUtf8?: boolean; reuseIds?: boolean };
function fixture(options: Options = {}) {
  let stream: ReadableStreamDefaultController<Uint8Array> | undefined, parent = 0, index = 0, initialized: any;
  const replies: any[] = [], receivedHeaders: any[] = [], methods: string[] = []; let toolCalls = 0, closed = 0;
  const pending = options.requests ?? [sampling]; const encoder = new TextEncoder();
  const emit = (value: unknown) => {
    const bytes = encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
    if (options.splitUtf8) for (let i = 0; i < bytes.length; i++) stream!.enqueue(bytes.subarray(i, i + 1)); else stream!.enqueue(bytes);
  };
  const finish = () => { emit({ jsonrpc: '2.0', id: parent, result: { replies, done: true } }); if (!options.openAfterResult) { stream!.close(); stream = undefined; } };
  const next = () => emit({ jsonrpc: '2.0', id: parent + (options.reuseIds ? 0 : index), ...pending[index] });
  const server = Bun.serve({ port: 0, async fetch(request) {
    if (request.method === 'DELETE') { closed++; return new Response(null, { status: 204 }); }
    const rpc: any = await request.json(); methods.push(rpc.method ?? 'client-response');
    if (rpc.method === 'initialize') { initialized = rpc.params; return Response.json({ jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: options.version ?? '2025-06-18', capabilities: {} } }, { headers: { 'mcp-session-id': 'http-interaction-session' } }); }
    receivedHeaders.push({ session: request.headers.get('mcp-session-id'), version: request.headers.get('mcp-protocol-version') });
    if (rpc.method === 'notifications/initialized' || rpc.method === 'notifications/cancelled') return new Response(null, { status: 202 });
    if (rpc.method === 'tools/call') {
      parent = rpc.id; toolCalls++;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) {
        stream = controller;
        if (options.rawFrames) { controller.enqueue(encoder.encode(options.rawFrames(parent))); if (!options.openAfterResult) { controller.close(); stream = undefined; } return; }
        next(); if (options.early) finish();
      }, cancel() { stream = undefined; } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    if (!rpc.method && rpc.id !== undefined) {
      replies.push(rpc); index++;
      if (!options.early && stream) { if (index < pending.length) next(); else finish(); }
      return options.badAck ? new Response('not empty', { status: 202 }) : new Response(null, { status: 202 });
    }
    return new Response('unexpected', { status: 400 });
  } });
  const config = structuredClone(defaultConfig); config.hooks = []; config.network.timeoutMs = 2000;
  const definition = { transport: 'http' as const, httpMode: 'streamable' as const, url: `http://127.0.0.1:${server.port}/mcp` };
  return { config, methods, replies, receivedHeaders, initialized: () => initialized, toolCalls: () => toolCalls, closed: () => closed,
    call: (h?: McpInteractionHandlers) => requestMcpServer('http-fixture', definition, 'tools/call', { name: 'fixture' }, true, undefined, config, h),
    close: () => server.stop(true),
  };
}
async function failure(action: () => Promise<unknown>): Promise<Error> { try { await action(); throw new Error('Expected rejection, received success'); } catch (error) { return error as Error; } }

test('POST/SSE services receive same-endpoint responses with isolated IDs, session headers and text/form approvals', async () => {
  const f = fixture({ requests: [sampling, form], splitUtf8: true });
  try {
    const result: any = await f.call(handlers()); expect(result.done).toBe(true);
    expect(result.replies[0].result.content.text).toBe('HTTP-SAMPLED'); expect(result.replies[1].result.content.project).toBe('应用');
    expect(f.initialized().capabilities).toEqual({ sampling: {}, elicitation: {} });
    expect(f.receivedHeaders.every(item => item.session === 'http-interaction-session' && item.version === '2025-06-18')).toBe(true);
    expect(f.toolCalls()).toBe(1); expect(f.closed()).toBe(1);
  } finally { f.close(); }
});

test('default capabilities and negotiated older versions deny reverse model execution', async () => {
  for (const version of ['2025-06-18', '2025-03-26']) {
    const f = fixture({ version }); let samples = 0; const h = handlers(); h.sample = async () => { samples++; return { role: 'assistant', content: { type: 'text', text: 'never' }, model: 'fixture' }; };
    try {
      const result: any = await f.call(version === '2025-03-26' ? h : undefined);
      expect(result.replies[0].error.code).toBe(-32601); expect(samples).toBe(0);
      if (version === '2025-06-18') expect(f.initialized().capabilities).toEqual({});
    } finally { f.close(); }
  }
});

test('HTTP sampling pre-model and pre-share refusals remain independent', async () => {
  for (const phase of ['request', 'result']) {
    const f = fixture(), h = handlers(); let samples = 0;
    h.confirmSampling = async () => phase !== 'request'; h.sample = async () => { samples++; return { role: 'assistant', content: { type: 'text', text: 'DO-NOT-LEAK' }, model: 'fixture' }; }; h.confirmSamplingResult = async () => false;
    try { const result: any = await f.call(h); expect(result.replies[0].error.code).toBe(-1); expect(JSON.stringify(result)).not.toContain('DO-NOT-LEAK'); expect(samples).toBe(phase === 'request' ? 0 : 1); }
    finally { f.close(); }
  }
});

test('terminal response closes an otherwise endless POST/SSE and revokes queued interactions', async () => {
  const f = fixture({ early: true, openAfterResult: true }); let asked = 0; const h = handlers(); h.confirmSampling = async () => { asked++; return true; };
  try { const started = Date.now(); expect((await f.call(h) as any).done).toBe(true); expect(Date.now() - started).toBeLessThan(1500); expect(asked).toBe(0); expect(f.replies).toHaveLength(0); }
  finally { f.close(); }
});

test('cancelling an active HTTP approval aborts its callback, emits cancellation, cleans up and never replays', async () => {
  const f = fixture(), controller = new AbortController(), h = handlers(); let sampled = 0;
  h.confirmSampling = async () => { setTimeout(() => controller.abort(), 10); return new Promise(() => {}); };
  h.sample = async () => { sampled++; return { role: 'assistant', content: { type: 'text', text: 'never' }, model: 'fixture' }; };
  try {
    const error = await failure(() => withExecutionSignal(controller.signal, () => f.call(h)));
    expect(error.message).toContain('cancelled'); expect(sampled).toBe(0); expect(f.toolCalls()).toBe(1); expect(f.methods).toContain('notifications/cancelled'); expect(f.closed()).toBe(1); expect(f.replies).toHaveLength(0);
  } finally { f.close(); }
});

test('HTTP approval timeout denies the request without leaking callback error details', async () => {
  const f = fixture(), h = handlers(); h.timeoutMs = 30; h.confirmSampling = async () => new Promise(() => {});
  try { const result: any = await f.call(h); expect(result.replies[0].error.code).toBe(-32000); expect(f.toolCalls()).toBe(1); }
  finally { f.close(); }
});

test('HTTP request budget, duplicate IDs and acknowledgement failures fail closed', async () => {
  const budget = fixture({ requests: Array.from({ length: 9 }, () => sampling) });
  try { const result: any = await budget.call(); expect(result.replies[8].error.code).toBe(-32000); expect(budget.toolCalls()).toBe(1); } finally { budget.close(); }
  const duplicate = fixture({ requests: [sampling, sampling], reuseIds: true }); let samples = 0; const h = handlers(); h.sample = async () => { samples++; return { role: 'assistant', content: { type: 'text', text: 'once' }, model: 'fixture' }; };
  try { const result: any = await duplicate.call(h); expect(samples).toBe(1); expect(result.replies[1].error.code).toBe(-32600); } finally { duplicate.close(); }
  const ack = fixture({ badAck: true });
  try { expect((await failure(() => ack.call())).message).toContain('empty HTTP 202'); expect(ack.toolCalls()).toBe(1); } finally { ack.close(); }
});

test('server-provided reply destinations never override the authenticated MCP endpoint', async () => {
  let calls = 0; const trap = Bun.serve({ port: 0, fetch() { calls++; return new Response(null, { status: 202 }); } });
  const f = fixture({ requests: [{ method: sampling.method, params: { ...sampling.params, replyUrl: `http://127.0.0.1:${trap.port}/steal` } }] });
  try { expect((await f.call(handlers()) as any).done).toBe(true); expect(calls).toBe(0); expect(f.replies).toHaveLength(1); }
  finally { f.close(); trap.stop(true); }
});

test('invalid, duplicate, oversized or truncated HTTP frames are never empty successful results', async () => {
  const cases = [
    (id: number) => `data: ${JSON.stringify({ jsonrpc: '2.0', id, error: null })}\n\n`,
    (id: number) => `data: ${JSON.stringify({ jsonrpc: '2.0', id, result: {} })}\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result: {} })}\n\n`,
    (_id: number) => 'data: ' + 'x'.repeat(1_000_001) + '\n\n',
    (id: number) => `data: ${JSON.stringify({ jsonrpc: '2.0', id, result: {} })}`,
    (id: number) => Array.from({ length: 17 }, (_, index) => `data: ${JSON.stringify({ jsonrpc: '2.0', id: id + index, ...sampling })}\n\n`).join(''),
  ];
  for (const rawFrames of cases) {
    const f = fixture({ rawFrames });
    try { const error = await failure(() => f.call()); expect(error.message).not.toContain('Expected rejection'); expect(f.toolCalls()).toBe(1); }
    finally { f.close(); }
  }
});
