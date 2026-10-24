// Independently npm-installed package, native Node, loopback only; no credentials.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const installation = resolve(process.argv[2] ?? '.');
const packageInfo = JSON.parse(await readFile(join(installation, 'node_modules/ccpt/package.json'), 'utf8'));
const root = await mkdtemp(join(tmpdir(), 'ccpt-responses-native-051-'));
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid smoke workspace');
process.env.CCPT_HOME = join(root, 'state');
process.env.CCPT_CLI_ENTRY = join(installation, 'node_modules/ccpt/dist/cli.js');
for (const name of Object.keys(process.env)) if (/^(ANTHROPIC_|OPENAI_|AZURE_OPENAI_|CCPT_(?:API|BASE|MODEL|ENDPOINT|MANAGED_CONFIG))/.test(name)) delete process.env[name];
const sdk = await import(pathToFileURL(join(installation, 'node_modules/ccpt/dist/entrypoints/sdk.js')).href);
const requests = [];
let mode = 'native';
const server = createServer(async (req, res) => {
  let data = ''; for await (const chunk of req) data += chunk;
  const body = JSON.parse(data); requests.push(body);
  if (mode === 'bridge') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'BRIDGE_OK' }, finish_reason: 'stop' }] }));
  assert(req.url.endsWith('/responses')); assert(!('messages' in body));
  let text = 'NATIVE_OK', output;
  if (body.instructions?.includes('probe-followup')) {
    assert(body.input.some(item => item.type === 'function_call_output' && item.call_id === 'call_read' && item.output === 'READ_OK'));
  } else if (body.tools?.some(tool => tool.name === 'probe')) output = [{ type: 'function_call', call_id: 'call_read', name: 'probe', arguments: '{}', status: 'completed' }];
  else if (body.tools?.some(tool => tool.name === 'read_file') && !body.input.some(item => item.type === 'function_call_output')) output = [{ type: 'function_call', call_id: 'call_file', name: 'read_file', arguments: '{"path":"fixture.txt"}', status: 'completed' }];
  else if (body.input.some(item => item.type === 'function_call_output')) { assert(JSON.stringify(body.input).includes('PACKED_FILE_OK')); text = 'PACKED_FILE_OK'; }
  output ??= [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }];
  const response = { id: `resp_packed_${requests.length}`, object: 'response', status: 'completed', output, usage: { input_tokens: 90, output_tokens: 4 } };
  if (body.stream) res.writeHead(200, { 'content-type': 'text/event-stream' }).end(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: output[0].type === 'message' ? text : '' })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response })}\n\n`);
  else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(installation, 'node_modules/ccpt/dist/cli.js'), ...args, '--cwd', root], { windowsHide: true, stdio: 'pipe', env: process.env });
    let out = '', err = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('CLI timeout')); }, 15000);
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; }); child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(err || out)); });
  });
}
try {
  const settings = { model: { provider: 'openai', endpointUrl: `http://127.0.0.1:${server.address().port}/responses`, name: 'fixture' },
    marketplaceEnabled: false, disableBundledSkills: true, network: { proxyUrl: '', allowedHosts: ['127.0.0.1'], timeoutMs: 8000 },
    policy: { workspaceRoots: [root] }, agents: { defaultIsolation: 'none', maxTurns: 4 } };
  await mkdir(join(root, '.ccpt'), { recursive: true });
  await writeFile(join(root, '.ccpt/settings.json'), JSON.stringify(settings)); await writeFile(join(root, 'fixture.txt'), 'PACKED_FILE_OK');
  const config = await sdk.loadSettings(root); assert.equal(config.model.provider, 'openai');
  let delta = '';
  const plain = await sdk.callModel(config, 'plain', [{ role: 'user', content: 'Reply' }], [], { onTextDelta(text) { delta += text; } });
  assert.equal(plain.response.object, 'response'); assert.equal(delta, 'NATIVE_OK');
  assert.deepEqual(plain.usage, { inputTokens: 90, outputTokens: 4 });
  const history = [{ role: 'user', content: 'Use probe' }];
  const tools = [{ name: 'probe', description: 'Fixture', input_schema: { type: 'object', properties: {} } }];
  const first = await sdk.callModel(config, 'tool test', history, tools);
  history.push({ role: 'assistant', content: first.content, responses: first.responses }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_read', content: 'READ_OK' }] });
  await sdk.callModel(config, 'probe-followup', history, tools);
  const agent = await sdk.runAgent({ cwd: root, prompt: 'Read fixture.txt using read_file and reply its exact content.', background: false });
  assert.equal(agent.status, 'completed'); assert.equal(agent.result, 'PACKED_FILE_OK');
  const session = await sdk.loadSession(agent.sessionId); assert(JSON.stringify(session.messages).includes('call_file'));
  const bg = await sdk.runAgent({ cwd: root, prompt: '你好', background: true });
  const completed = await sdk.waitForAgent(bg.id, 10000); assert.equal(completed.status, 'completed');
  assert.equal((await cli(['--version'])).trim(), packageInfo.version);
  assert((await cli(['config', 'show'])).includes('openai'));
  mode = 'bridge'; config.model.responsesTransport = 'chat-completions'; config.model.endpointUrl = `http://127.0.0.1:${server.address().port}/chat/completions`;
  const bridge = await sdk.callModel(config, 'bridge', [{ role: 'user', content: 'Hello' }], []);
  assert.equal(bridge.response.metadata.ccpt_transport, 'chat-completions'); assert.equal(bridge.content[0].text, 'BRIDGE_OK');
  assert(requests.at(-1).messages); assert(!requests.at(-1).input);
  console.log(JSON.stringify({ ok: true, node: process.version, nativeResponses: true, sdk: true, streaming: true, tools: true, realFileRead: true, backgroundWorker: true, explicitBridge: true, npmInstalled: true, requests: requests.length }));
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
