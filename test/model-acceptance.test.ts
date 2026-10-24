import { expect, test } from 'bun:test';
import { defaultConfig } from '../src/config.js';
import { probeModelAcceptance } from '../src/modelProbe.js';
import { withExecutionSignal } from '../src/executionControl.js';

for (const protocol of ['responses', 'chat-completions'] as const) test(`${protocol} acceptance: chat, history, full catalog, echo and real stream cancellation`, async () => {
  const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const body: any = await request.json(); requests.push(body); const index = requests.length;
    const marker = JSON.stringify(body).match(/CCPT_[a-f0-9]{32}/)?.[0] ?? 'CCPT_OK';
    const delta = protocol === 'responses' ? { type: 'response.output_text.delta', delta: index === 7 ? 'CANCEL' : marker } : { choices: [{ delta: { content: index === 7 ? 'CANCEL' : marker } }] };
    if (index === 7) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta)}\n\n`)); } }), { headers: { 'content-type': 'text/event-stream' } });
    const output = index === 4 ? [{ type: 'function_call', call_id: 'probe-call', name: 'ccpt_probe_echo', arguments: '{"value":"CCPT_OK"}' }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: marker }] }];
    const response = protocol === 'responses' ? { id: `resp_${index}`, status: 'completed', output } : { choices: [{ message: index === 4 ? { role: 'assistant', tool_calls: [{ id: 'probe-call', type: 'function', function: { name: 'ccpt_probe_echo', arguments: '{"value":"CCPT_OK"}' } }] } : { role: 'assistant', content: marker }, finish_reason: index === 4 ? 'tool_calls' : 'stop' }] };
    if (index === 6) return new Response(`data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify(protocol === 'responses' ? { type: 'response.completed', response } : response)}\n\n${protocol === 'responses' ? '' : 'data: [DONE]\n\n'}`, { headers: { 'content-type': 'text/event-stream' } });
    return Response.json(response);
  } });
  const config = structuredClone(defaultConfig); config.model.apiProtocol = protocol; config.model.endpointUrl = `http://127.0.0.1:${server.port}/${protocol === 'responses' ? 'responses' : 'chat/completions'}`; config.model.apiKeyEnv = ''; config.network.proxyUrl = ''; config.network.allowedHosts = ['127.0.0.1'];
  try {
    const report = await probeModelAcceptance(config, true, { timeoutMs: 2000 });
    expect(report.ok, JSON.stringify(report)).toBe(true); expect(report.checks).toHaveLength(5); expect(requests).toHaveLength(7);
    expect(report.checks[1]?.report.conversationRoundTrip).toBe(true); expect(report.checks[2]?.report.toolRoundTrip).toBe(true); expect(report.checks[2]?.report.catalogToolCount).toBeGreaterThan(20); expect(report.checks[4]?.report.cancellationObserved).toBe(true);
    const history = protocol === 'responses' ? requests[2].input : requests[2].messages;
    expect(history.some((item: any) => item.role === 'assistant')).toBe(true);
    expect(JSON.stringify(requests[4])).toContain('probe-call');
    if (protocol === 'responses') expect(requests.every(body => body.store === false)).toBe(true);
    expect(config.model.maxOutputTokens).toBe(defaultConfig.model.maxOutputTokens);
  } finally { server.stop(true); }
}, 15000);

test('acceptance needs explicit confirmation; stops on first error and only includes sanitized diagnostics', async () => {
  let calls = 0;
  const server = Bun.serve({ port: 0, fetch() { calls++; return Response.json({ error: { code: 'bad_schema', param: 'tools[0]', message: 'Authorization: Bearer fixture-secret' } }, { status: 400, headers: { 'x-request-id': 'request-fixture' } }); } });
  const config = structuredClone(defaultConfig); config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`; config.model.apiKeyEnv = ''; config.network.proxyUrl = '';
  try {
    await expect(probeModelAcceptance(config, false)).rejects.toThrow('--confirm'); expect(calls).toBe(0);
    const report = await probeModelAcceptance(config, true, { diagnostics: true }); expect(report.ok).toBe(false); expect(report.checks).toHaveLength(1); expect(calls).toBe(1);
    expect(report.checks[0]?.report.diagnostics).toMatchObject({ code: 'bad_schema', param: 'tools[0]', requestId: 'request-fixture' }); expect(JSON.stringify(report)).not.toContain('fixture-secret');
    const controller = new AbortController(); controller.abort();
    const cancelled = await withExecutionSignal(controller.signal, () => probeModelAcceptance(config, true)); expect(cancelled.ok).toBe(false); expect(calls).toBe(1);
  } finally { server.stop(true); }
});

test('a completed JSON response cannot masquerade as successful streaming cancellation', async () => {
  const server = Bun.serve({ port: 0, async fetch(request) { const body: any = await request.json(); const marker = JSON.stringify(body).match(/CCPT_[a-f0-9]{32}/)?.[0] ?? 'CCPT_OK'; const tool = body.tools?.length && !JSON.stringify(body.input).includes('function_call_output'); return Response.json({ id: 'resp_json', status: 'completed', output: tool ? [{ type: 'function_call', call_id: 'probe-call', name: 'ccpt_probe_echo', arguments: '{"value":"CCPT_OK"}' }] : [{ type: 'message', content: [{ type: 'output_text', text: marker }] }] }); } });
  const config = structuredClone(defaultConfig); config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`; config.model.apiKeyEnv = ''; config.network.proxyUrl = '';
  try { const report = await probeModelAcceptance(config, true); expect(report.ok).toBe(false); expect(report.checks.at(-1)?.report.cancellationObserved).toBe(false); }
  finally { server.stop(true); }
});
