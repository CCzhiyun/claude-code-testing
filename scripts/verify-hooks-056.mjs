// Positive lifecycle and Stop-retry check using the built Node SDK; loopback only.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const project = dirname(dirname(fileURLToPath(import.meta.url)));
const root = await mkdtemp(join(tmpdir(), 'ccpt-hooks-056-'));
if (!root.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid temporary fixture');
for (const name of Object.keys(process.env)) if (/^(CCPT_|ANTHROPIC_|OPENAI_|AZURE_OPENAI_)/.test(name)) delete process.env[name];
process.env.CCPT_HOME = join(root, 'home');
const sdk = await import(pathToFileURL(join(project, 'dist/entrypoints/sdk.js')).href);
let requests = 0;
const server = createServer(async (req, res) => {
  let text = ''; for await (const data of req) text += data;
  const body = JSON.parse(text); requests++;
  if (requests === 2) assert(JSON.stringify(body).includes('Completion quality gate feedback'));
  const response = { id: `resp_hook_${requests}`, object: 'response', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'VERIFIED', annotations: [] }] }], usage: { input_tokens: 30, output_tokens: 3 } };
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(response));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
try {
  const log = join(root, 'hook-log.jsonl'), events = ['SessionStart','UserPromptSubmit','InstructionsLoaded','Stop','TaskCompleted','TeammateIdle','SessionEnd'];
  const command = `node "${join(project,'scripts/fixtures/hook-lifecycle-056.cjs')}" "${log}"`;
  await mkdir(join(root,'.ccpt'));
  await writeFile(join(root,'.ccpt/settings.json'), JSON.stringify({
    model: { provider:'openai', endpointUrl:`http://127.0.0.1:${server.address().port}/responses`, name:'fixture' },
    marketplaceEnabled:false, disableBundledSkills:true,
    network:{ proxyUrl:'', allowedHosts:['127.0.0.1'], timeoutMs:8000 },
    policy:{ workspaceRoots:[root] }, agents:{ defaultIsolation:'none', maxTurns:4 },
    hooks:events.map(event => ({ event, type:'command', command })),
  }));
  const agent = await sdk.runAgent({ cwd:root, prompt:'Explain this fixture architecture without calling tools.', background:false });
  assert.equal(agent.status,'completed'); assert.equal(agent.result,'VERIFIED'); assert.equal(requests,2);
  const rows = (await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row=>row.hook_event_name), ['SessionStart','UserPromptSubmit','InstructionsLoaded','Stop','Stop','TaskCompleted','TeammateIdle','SessionEnd']);
  assert.equal(rows.filter(row=>row.hook_event_name==='Stop')[1].stop_hook_active,true);
  assert(rows.every(row=>row.session_id===agent.sessionId));
  const report = {pass:true,runtime:'built Node SDK plus real command Hook children',checks:['actual positive lifecycle order','Stop exit 2 feeds back within same session','second Stop has stop_hook_active','completion accepted only after gate passes','SessionEnd exactly once on successful completion'],modelRequests:requests,loopbackOnly:true,companyRequests:0,userSettingsModified:false};
  await mkdir(join(project,'.ccpt/foundation-056/final'),{recursive:true});
  await writeFile(join(project,'.ccpt/foundation-056/final/node-hooks-smoke.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {
  server.closeAllConnections(); await new Promise(done=>server.close(done));
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
