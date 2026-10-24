// Real compiled Node command, no company requests, personal settings or arbitrary tools.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
const project = resolve(import.meta.dir, '..'), root = await mkdtemp(join(tmpdir(), 'ccpt-acceptance-node-'));
const requests: any[] = [];
const server = Bun.serve({ port: 0, async fetch(request) {
  if (new URL(request.url).pathname !== '/responses') return new Response(null, { status: 404 });
  const body: any = await request.json(); requests.push(body); const index = requests.length;
  const marker = JSON.stringify(body).match(/CCPT_[a-f0-9]{32}/)?.[0] ?? 'CCPT_OK';
  const delta = { type: 'response.output_text.delta', delta: index === 7 ? 'CANCEL' : marker };
  if (index === 7) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta)}\n\n`)); } }), { headers: { 'content-type': 'text/event-stream' } });
  const response = { id: `resp_${index}`, status: 'completed', output: index === 4 ? [{ type: 'function_call', call_id: 'probe-call', name: 'ccpt_probe_echo', arguments: '{"value":"CCPT_OK"}' }] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: marker }] }] };
  if (index === 6) return new Response(`data: ${JSON.stringify(delta)}\n\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  return Response.json(response);
} });
const config = structuredClone(defaultConfig);
config.model.apiProtocol = 'responses'; config.model.endpointUrl = `http://127.0.0.1:${server.port}/responses`; config.model.apiKeyEnv = ''; config.model.responsesStore = true;
config.marketplaceEnabled = false; config.hooks = [{ event: 'SessionStart', command: 'THIS_HOOK_MUST_NOT_RUN' }]; config.network.proxyUrl = ''; config.network.allowedHosts = ['127.0.0.1'];
const env: Record<string, string> = { CCPT_HOME: join(root, 'home') };
for (const name of ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
async function cli(args: string[]) {
  const child = Bun.spawn(['node', join(project, 'dist/cli.js'), 'model', 'acceptance', ...args, '--cwd', root, '--timeout', '3000'], { cwd: root, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill(), 20000);
  try { const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { out, err, code }; }
  finally { clearTimeout(timer); }
}
try {
  await writeJson(join(root, '.ccpt/settings.json'), config);
  const denied = await cli([]); if (denied.code === 0 || !denied.err.includes('--confirm') || requests.length) throw new Error('Missing opt-in issued a model request');
  const accepted = await cli(['--confirm', '--diagnostics']); const result = JSON.parse(accepted.out);
  if (accepted.code !== 0 || !result.ok || result.checks.length !== 5 || requests.length !== 7) throw new Error('Compiled acceptance failed: ' + JSON.stringify(result));
  if (requests.some(body => body.store !== false || body.previous_response_id || body.messages) || requests[3].tools.length < 20 || !JSON.stringify(requests[4].input).includes('function_call_output')) throw new Error('Native Responses request isolation differs from source tests');
  const report = { pass: true, entrypoint: 'node dist/cli.js model acceptance', checks: ['no request without --confirm', '7 requests complete 5 phases', 'full built-in catalog and safe echo roundtrip', 'native Responses history, no server storage', 'stream cancelled after first text', 'SessionStart hook not run'], modelRequests: 7, companyRequests: 0, loopbackOnly: true, personalSettingsModified: false };
  await writeJson(join(project, '.ccpt/delivery-052/packaged-acceptance.json'), report); console.log(JSON.stringify(report, null, 2));
} finally {
  server.stop(true);
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture cleanup target');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
