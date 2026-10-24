import { expect, test } from 'bun:test';
import packageMetadata from '../package.json' with { type: 'json' };
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { watchMcpServer } from '../src/mcp.js';
import { validateWatchOptions } from '../src/mcpNotifications.js';
import { networkRequest } from '../src/network.js';
import { SseDecoder } from '../src/cli/transports/SSETransport.js';
import { writeJson } from '../src/storage.js';

const event = (id: string, message: unknown) => `id: ${id}\r\ndata: ${JSON.stringify(message)}\r\n\r\n`;
const notification = (value: string) => ({ jsonrpc: '2.0', method: 'notifications/message', params: { data: value } });
const sse = (text: string) => new Response(text, { headers: { 'content-type': 'text/event-stream' } });
async function fixture(action: (ctx: {
  config: typeof defaultConfig; root: string; gets: Request[]; posts: any[]; closed: () => number;
  onGet: (handler: (request: Request, index: number) => Response | Promise<Response>) => void;
}) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-mcp-watch-'));
  const previous = process.env.CCPT_HOME; process.env.CCPT_HOME = root;
  const gets: Request[] = [], posts: any[] = []; let deletes = 0;
  let get = (_request: Request, _index: number): Response | Promise<Response> => sse('');
  const server = Bun.serve({ port: 0, async fetch(request) {
    if (request.method === 'DELETE') { deletes++; return new Response(null, { status: 204 }); }
    if (request.method === 'GET') { gets.push(new Request(request.url, { headers: new Headers(request.headers) })); return get(request, gets.length); }
    const body = await request.json() as any; posts.push(body);
    if (body.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }, { headers: { 'mcp-session-id': 'watch-session' } });
    return new Response(null, { status: 202 });
  } });
  const config = structuredClone(defaultConfig); config.hooks = []; config.marketplaceEnabled = false;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 1000 };
  config.mcpServers = { fixture: { transport: 'http', httpMode: 'streamable', url: `http://127.0.0.1:${server.port}/mcp` } };
  try { await action({ config, root, gets, posts, closed: () => deletes, onGet: handler => { get = handler; } }); }
  finally { server.stop(true); if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await rm(root, { recursive: true, force: true }); }
}

test('GET listener resumes the same session, deduplicates IDs, handles UTF-8, pings and denies sampling without executing tools', async () => fixture(async ({ config, gets, posts, closed, onGet }) => {
  onGet((_request, index) => {
    if (index === 1) {
      const bytes = new TextEncoder().encode(event('e1', notification('你好')));
      return new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    return sse(event('e1', notification('duplicate')) + event('e2', notification('second')) + event('ping', { jsonrpc: '2.0', id: 'p', method: 'ping' }) + event('sample', { jsonrpc: '2.0', id: 's', method: 'sampling/createMessage', params: { dangerous: 'do not execute' } }) + event('e3', notification('third')));
  });
  const seen: unknown[] = [];
  const rejected: unknown[] = [];
  const result = await watchMcpServer('fixture', config, { durationMs: 2000, maxEvents: 3, reconnectDelayMs: 10, onNotification: value => { seen.push(value); }, onDeniedRequest: value => { rejected.push(value); } });
  expect(result).toEqual({ reason: 'event-limit', notifications: 3, reconnects: 1, deniedRequests: 1, pings: 1 });
  expect(seen.map((value: any) => value.params.data)).toEqual(['你好', 'second', 'third']);
  expect(gets).toHaveLength(2); expect(gets[1]!.headers.get('last-event-id')).toBe('e1');
  expect(gets.every(request => request.headers.get('mcp-session-id') === 'watch-session' && request.headers.get('mcp-protocol-version') === '2025-06-18')).toBe(true);
  expect(posts.map(post => post.method).filter(Boolean)).toEqual(['initialize', 'notifications/initialized']);
  expect(posts[0].params.clientInfo.version).toBe(packageMetadata.version);
  expect(posts.find(post => post.id === 'p')).toMatchObject({ result: {} });
  expect(posts.find(post => post.id === 's')).toMatchObject({ error: { code: -32601 } }); expect(closed()).toBe(1);
  expect(rejected).toMatchObject([{ method: 'sampling/createMessage' }]); expect(JSON.stringify(rejected)).not.toContain('do not execute');
}));

test('independent GET sampling requires request and sharing approval; reconnect never repeats an approved request',()=>fixture(async({config,gets,posts,onGet})=>{
 let approvals=0,samples=0,shares=0;
 const sampling={jsonrpc:'2.0',id:'sample-live',method:'sampling/createMessage',params:{messages:[{role:'user',content:{type:'text',text:'Explain fixture'}}],maxTokens:20}};
 onGet((_request,index)=>sse(event('sampling',sampling)+event(`n${index}`,notification('complete'))));
 await watchMcpServer('fixture',config,{durationMs:2000,maxEvents:2,reconnectDelayMs:10,interactions:{confirmSampling:async()=>{approvals++;return true;},sample:async()=>{samples++;return {role:'assistant',model:'fixture',content:{type:'text',text:'APPROVED_OUTPUT'}};},confirmSamplingResult:async()=>{shares++;return true;}}});
 expect([approvals,samples,shares]).toEqual([1,1,1]);expect(posts[0].params.capabilities).toHaveProperty('sampling');expect(posts.find(p=>p.id==='sample-live')).toMatchObject({result:{content:{text:'APPROVED_OUTPUT'}}});expect(gets[1]!.headers.get('last-event-id')).toBe('n1');
}));
test('independent GET declined sharing sends no sampled text and restricted mode rejects interactive callbacks',()=>fixture(async({config,posts,onGet})=>{
 onGet(()=>sse(event('sampling',{jsonrpc:'2.0',id:'private',method:'sampling/createMessage',params:{messages:[{role:'user',content:{type:'text',text:'Request'}}],maxTokens:20}})+event('done',notification('complete'))));
 const interactions={confirmSampling:async()=>true,sample:async()=>({role:'assistant' as const,model:'fixture',content:{type:'text' as const,text:'DO_NOT_SHARE'}}),confirmSamplingResult:async()=>false};
 await watchMcpServer('fixture',config,{maxEvents:1,interactions});expect(JSON.stringify(posts)).not.toContain('DO_NOT_SHARE');expect(posts.find(p=>p.id==='private')).toHaveProperty('error');
 config.policy.mode='restricted';const before=posts.length;await expect(watchMcpServer('fixture',config,{interactions})).rejects.toThrow('restricted');expect(posts).toHaveLength(before);
}));
test('independent GET duplicate IDs and interaction budget cannot trigger repeated human/model work',()=>fixture(async({config,posts,onGet})=>{
 let samples=0;const request=(id:string)=>({jsonrpc:'2.0',id,method:'sampling/createMessage',params:{messages:[{role:'user',content:{type:'text',text:'Fixture'}}],maxTokens:20}});
 onGet(()=>sse(event('one',request('same'))+event('two',request('same'))+event('three',request('new'))+event('four',notification('done'))));
 const result=await watchMcpServer('fixture',config,{maxEvents:1,maxInteractions:1,interactions:{confirmSampling:async()=>true,sample:async()=>{samples++;return {role:'assistant',model:'fixture',content:{type:'text',text:'one'}};},confirmSamplingResult:async()=>true}});
 expect(samples).toBe(1);expect(result.deniedRequests).toBe(2);expect(posts.filter(p=>'error' in p)).toHaveLength(2);
}));

test('id-only priming and duplicate replay do not regress the resume cursor', async () => fixture(async ({ config, gets, onGet }) => {
  onGet((_request, index) => index === 1 ? sse('id: prime\ndata:\n\n') : index === 2 ? sse(event('e1', notification('one')) + event('e2', notification('two')) + event('e1', notification('old'))) : sse(event('e3', notification('three'))));
  const result = await watchMcpServer('fixture', config, { maxEvents: 3, durationMs: 2000, reconnectDelayMs: 10 });
  expect(result.notifications).toBe(3); expect(gets[1]!.headers.get('last-event-id')).toBe('prime'); expect(gets[2]!.headers.get('last-event-id')).toBe('e2');
}));

test('unsupported GET, auth failures, redirects and expired sessions stop without reinitialization or tool replay', async () => {
  for (const status of [301, 401, 403, 404, 405, 429]) await fixture(async ({ config, gets, posts, closed, onGet }) => {
    onGet(() => new Response('private provider detail', { status, headers: { location: 'http://do-not-follow.invalid' } }));
    await expect(watchMcpServer('fixture', config, { durationMs: 1000 })).rejects.toThrow(/MCP/);
    expect(gets).toHaveLength(1); expect(posts).toHaveLength(2); expect(closed()).toBe(1);
  });
});

test('malformed messages and excessive frames fail closed; wrong content-type is never dispatched', async () => {
  for (const response of [() => sse('data: invalid\n\n'), () => sse(event('bad', { jsonrpc: '2.0', id: 1, result: {} })), () => sse('data: ' + 'x'.repeat(1_000_001)), () => Response.json(notification('not SSE'))]) await fixture(async ({ config, gets, onGet }) => {
    let delivered = 0; onGet(response);
    await expect(watchMcpServer('fixture', config, { onNotification: () => { delivered++; }, durationMs: 1000 })).rejects.toThrow();
    expect(delivered).toBe(0); expect(gets).toHaveLength(1);
  });
});

test('user cancellation and duration release live GET sockets and delete the session', async () => {
  for (const cancel of [false, true]) await fixture(async ({ config, closed, onGet }) => {
    let streamClosed = false;
    onGet(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(': connected\n\n')); }, cancel() { streamClosed = true; } }), { headers: { 'content-type': 'text/event-stream' } }));
    const controller = new AbortController();
    const result = await watchMcpServer('fixture', config, { durationMs: cancel ? 2000 : 50, signal: controller.signal, onStatus: status => { if (cancel && status.state === 'connected') controller.abort(); } });
    expect(result.reason).toBe(cancel ? 'cancelled' : 'duration'); expect(closed()).toBe(1);
    await Bun.sleep(30); expect(streamClosed).toBe(true);
  });
});

test('reconnect attempts and callback failures are bounded', async () => fixture(async ({ config, gets, onGet }) => {
  onGet(() => sse(''));
  await expect(watchMcpServer('fixture', config, { durationMs: 2000, reconnectDelayMs: 10, maxReconnects: 2 })).rejects.toThrow('reconnect limit');
  expect(gets).toHaveLength(3);
  onGet(() => sse(event('e', notification('hello'))));
  await expect(watchMcpServer('fixture', config, { onNotification: () => { throw new Error('secret callback detail'); } })).rejects.toThrow('processing failed');
  expect(gets).toHaveLength(4);
}));

test('credentials reload on reconnect; external network policy and pre-cancelled watches prevent requests', async () => fixture(async ({ config, gets, onGet }) => {
  const old = process.env.CCPT_WATCH_TEST_TOKEN;
  process.env.CCPT_WATCH_TEST_TOKEN = 'first-fixture'; config.mcpServers.fixture!.tokenEnv = 'CCPT_WATCH_TEST_TOKEN';
  try {
    onGet((_request, index) => sse(event(`e${index}`, notification('event'))));
    await watchMcpServer('fixture', config, { durationMs: 1000, reconnectDelayMs: 10, maxEvents: 2, onNotification: () => { process.env.CCPT_WATCH_TEST_TOKEN = 'next-fixture'; } });
    expect(gets.map(request => request.headers.get('authorization'))).toEqual(['Bearer first-fixture', 'Bearer next-fixture']);
    const controller = new AbortController(); controller.abort();
    await expect(watchMcpServer('fixture', config, { signal: controller.signal })).rejects.toThrow(); expect(gets).toHaveLength(2);
    config.policy.allowNetwork = false; config.mcpServers.fixture!.url = 'https://example.invalid/mcp';
    await expect(watchMcpServer('fixture', config)).rejects.toThrow('disabled by policy'); expect(gets).toHaveLength(2);
  } finally { if (old === undefined) delete process.env.CCPT_WATCH_TEST_TOKEN; else process.env.CCPT_WATCH_TEST_TOKEN = old; }
}));

test('network stream consumer can avoid body retention while default requests still collect the body', async () => fixture(async ({ config, onGet }) => {
  onGet(() => sse('data: hello\n\n')); let data = '';
  const first = await networkRequest(config.mcpServers.fixture!.url!, { collectBody: false, onData: chunk => { data += chunk.toString(); } }, config.network);
  expect(data).toContain('hello'); expect(first.body.length).toBe(0); expect(first.text).toBe('');
  expect((await networkRequest(config.mcpServers.fixture!.url!, {}, config.network)).text).toContain('hello');
}));

test('watch option limits and SSE frame limits are validated', () => {
  for (const options of [{ durationMs: 0 }, { durationMs: Infinity }, { maxEvents: 10001 }, { maxReconnects: -1 }, { reconnectDelayMs: 1 }]) expect(() => validateWatchOptions(options)).toThrow();
  expect(new SseDecoder().push('id: cursor\ndata:\n\n')).toEqual([{ data: '', id: 'cursor' }]);
  expect(() => new SseDecoder(5).push('data: too long\n\n')).toThrow('size limit');
});

test('actual CLI watch emits NDJSON notifications/results without model or plugin execution', async () => fixture(async ({ config, root, posts, onGet }) => {
  onGet(() => sse(event('cli1', notification('CLI_NOTIFY'))));
  await writeJson(join(root, 'settings.json'), config);
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, '../src/cli.ts'), 'mcp', 'watch', 'fixture', '--timeout', '1500', '--max-events', '1'], { cwd: root, env: { ...process.env, CCPT_HOME: root }, stdout: 'pipe', stderr: 'pipe' });
  const [exit, output, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(exit, err).toBe(0);
  const records = output.trim().split('\n').map(line => JSON.parse(line));
  expect(records[0]).toMatchObject({ type: 'mcp_notification', notification: { params: { data: 'CLI_NOTIFY' } } });
  expect(records[1]).toMatchObject({ type: 'mcp_watch_result', reason: 'event-limit' }); expect(posts).toHaveLength(2);
}));
