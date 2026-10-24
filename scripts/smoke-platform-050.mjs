// Native Node + independently npm-installed bundle, loopback fixtures only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const installation = resolve(process.argv[2] ?? '.');
const temporary = await mkdtemp(join(tmpdir(), 'ccpt-native-050-'));
if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid smoke workspace');
process.env.CCPT_HOME = join(temporary, 'home');
// Explicit fixture settings beat inherited company/model environment.
for (const key of Object.keys(process.env)) if (/^(CCPT_(?:API|BASE|MODEL|ENDPOINT)|ANTHROPIC_|OPENAI_|AZURE_OPENAI_)/.test(key)) delete process.env[key];
const sdk = await import(pathToFileURL(join(installation, 'node_modules/ccpt/dist/entrypoints/sdk.js')).href);
const requests = [];
const server = createServer(async (request, response) => {
  let data = ''; for await (const chunk of request) data += chunk;
  requests.push(JSON.parse(data));
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: 'NATIVE-FIXTURE-DONE' } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function file(path, content) { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content); }
async function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(installation, 'node_modules/ccpt/dist/cli.js'), ...args, '--cwd', temporary], { windowsHide: true, stdio: 'pipe', env: process.env });
    let stdout = '', stderr = ''; const timer = setTimeout(() => { child.kill(); reject(new Error('Native CLI timed out')); }, 15000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); if (code !== 0) reject(new Error(stderr)); else resolve(stdout); });
  });
}
try {
  const settings = { marketplaceEnabled: false, disableBundledSkills: true,
    model: { provider: 'compatible', apiProtocol: 'chat-completions', name: 'fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, reasoningEffort: 'low', thinkingEnabled: false },
    network: { allowedHosts: ['127.0.0.1'], proxyUrl: '', timeoutMs: 8000 },
    policy: { workspaceRoots: [temporary] }, agents: { defaultIsolation: 'none', maxTurns: 4 },
    agentDefinitions: { reviewer: { description: 'Review', prompt: 'NATIVE-SPECIALIST', tools: ['read_file'], memory: 'project' } } };
  await file(join(temporary, '.ccpt/settings.json'), JSON.stringify(settings));
  await file(join(temporary, '.ccpt/skills/explain/SKILL.md'), '---\nname: explain\ndescription: Explain\ndisable-model-invocation: true\nallowed-tools: Read\n---\nINLINE-RULE $ARGUMENTS');
  await file(join(temporary, '.ccpt/skills/investigate/SKILL.md'), '---\nname: investigate\ndescription: Investigate\ncontext: fork\nagent: reviewer\nallowed-tools: Read\n---\nFORK-RULE $0');
  const config = await sdk.loadSettings(temporary);
  const lead = await sdk.runAgent({ cwd: temporary, prompt: 'LEAD-NATIVE-MARKER', background: false });
  const inline = JSON.parse(await cli(['skill', 'run', 'explain', 'architecture', '--agent-id', lead.id]));
  assert.equal(inline.agent.id, lead.id); assert.equal(inline.forked, false);
  assert(requests[1].messages.some(message => message.content === 'LEAD-NATIVE-MARKER'));
  assert(requests[1].messages[0].content.includes('INLINE-RULE architecture'));
  assert.deepEqual(requests[1].tools.map(tool => tool.function.name), ['read_file']);
  await sdk.continueAgent(lead.id, 'Ordinary continuation', { config, background: false });
  assert(!requests[2].messages[0].content.includes('INLINE-RULE'));
  assert(requests[2].tools.some(tool => tool.function.name === 'write_file'));
  const before = await sdk.loadSession(lead.sessionId);
  const fork = await sdk.invokeUserSkill({ name: 'investigate', args: 'layout', agentId: lead.id, cwd: temporary, config });
  assert.equal(fork.forked, true); assert.notEqual(fork.agent.sessionId, lead.sessionId); assert.equal(fork.agent.parentId, lead.id);
  assert(!JSON.stringify(requests[3]).includes('LEAD-NATIVE-MARKER'));
  assert.deepEqual((await sdk.loadSession(lead.sessionId)).messages, before.messages);
  const team = JSON.parse(await cli(['teams', 'create', lead.id, 'Native Engineering']));
  assert.equal(team.teamSessionId, lead.sessionId);
  const sent = JSON.parse(await cli(['teams', 'broadcast', lead.id, 'Shared evidence'])); assert.equal(sent.delivered.length, 1);
  assert.equal(JSON.parse(await cli(['teams', 'members', lead.id])).length, 2);
  assert.equal(JSON.parse(await cli(['teams', 'inbox', fork.agent.id])).length, 1);
  // A completed member retains its truthful terminal status; shutdown still acknowledges/consumes the control.
  await cli(['teams', 'shutdown', lead.id, fork.agent.id]); assert.equal((await sdk.loadAgent(fork.agent.id)).status, 'completed');
  assert((await sdk.teamMailbox.readTeamMailbox({ teamSessionId: lead.sessionId, agentId: lead.id, markRead: false })).some(message => message.content.includes('Shutdown acknowledged')));
  await sdk.continueAgent(fork.agent.id, 'Human resumes after shutdown', { config, background: false });
  assert.equal((await sdk.loadAgent(fork.agent.id)).status, 'completed');
  const memory = sdk.agentMemory.agentMemoryDirectory(temporary, { name: 'reviewer', memory: 'project' });
  await sdk.agentMemory.writeAgentMemory(memory, 'MEMORY', 'Fixture engineering knowledge');
  assert.equal(await sdk.agentMemory.readAgentMemory(memory), 'Fixture engineering knowledge');
  const visibility = JSON.parse(await cli(['skills', 'visibility', 'explain', 'off'])); assert.equal(visibility.effective, 'off');
  assert.equal(JSON.parse(await readFile(join(temporary, '.ccpt/settings.json'))).skillOverrides.explain, 'off');
  await cli(['teams', 'cleanup', team.id, 'confirm']); assert.equal((await sdk.teams.listTeams()).length, 0);
  assert((await sdk.loadSession(lead.sessionId)).messages.length > 0);
  assert.match(await cli(['skills', '--help']), /four|visibility/); assert.match(await cli(['teams', '--help']), /shutdown/);
  console.log('Native Node installed-package smoke passed: CLI/SDK inline and fork Skills, same conversation, capability expiry, Teams membership/broadcast/shutdown/resume/cleanup, specialist memory, persisted visibility. Loopback only.');
} finally {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
