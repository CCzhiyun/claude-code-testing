// Explicit paid integration check. Sends fixed synthetic prompts, never repository files.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { loadConfig } from '../src/config.js';
import { callModel } from '../src/model.js';
import { resolveModelProtocol, resolveModelWireProtocol } from '../src/modelConnection.js';
import { withExecutionSignal } from '../src/executionControl.js';
import { spawnAgent, continueAgent } from '../src/agent.js';
import { loadSession } from '../src/sessions.js';
import type { ModelMessage } from '../src/types.js';

if (!process.argv.includes('--confirm-live')) throw new Error('This performs paid model calls. Use --confirm-live only after selecting settings and credentials.');
const config = await loadConfig(process.cwd());
if (resolveModelProtocol(config.model) !== 'responses') throw new Error('Select Responses settings first');
const credentialName = config.model.apiKeyEnv, credential = credentialName ? process.env[credentialName] : undefined;
const root = await mkdtemp(join(tmpdir(), 'ccpt-responses-live-'));
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid temporary workspace');
const priorHome = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'state');
// The isolated state has no settings-injected secret. Convert the selected key to
// an explicit process environment for this run, without copying it to any file.
await loadConfig(root);
if (credentialName && credential) process.env[credentialName] = credential;
config.model.maxOutputTokens = 2048; config.modelRetry = { maxRetries: 0 };
config.network.timeoutMs = 60000; config.marketplaceEnabled = false;
config.hooks = []; config.mcpServers = {}; config.pluginDirectories = []; config.disableBundledSkills = true;
config.skillsDirectories = []; config.agentsDirectories = [];
config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none'; config.agents.maxTurns = 4;
config.spending = { maxRequests: 8 };
const checks: Record<string, boolean> = {};
try {
  const history: ModelMessage[] = [{ role: 'user', content: 'Remember this synthetic marker: CCPT_BLUE_51. Reply CCPT_OK only.' }];
  const first = await callModel(config, 'Follow this fixed diagnostic prompt only.', history, []);
  checks.standardResponse = first.response?.object === 'response' && first.response.status === 'completed';
  checks.ordinaryChat = first.content.some(b => b.type === 'text' && b.text?.includes('CCPT_OK'));
  history.push({ role: 'assistant', content: first.content, ...(first.responses ? { responses: first.responses } : {}) }, { role: 'user', content: 'Reply with the synthetic marker from my previous message, no other text.' });
  const second = await callModel(config, 'Follow this fixed diagnostic prompt only.', history, []);
  checks.multiTurn = second.content.some(b => b.type === 'text' && b.text?.includes('CCPT_BLUE_51'));
  await writeFile(join(root, 'fixture.txt'), 'CCPT_READ_RESULT_51');
  let toolStarted = false;
  let agent = await spawnAgent({ cwd: root, config, background: false, isolation: 'none', allowedTools: ['read_file'],
    goal: 'Call read_file to read fixture.txt. Then reply with its exact contents only. Do not use any other tools.',
    onEvent(event) { if (event.type === 'tool_started' && event.name === 'read_file') toolStarted = true; } });
  checks.realTool = toolStarted && agent.status === 'completed' && agent.result?.includes('CCPT_READ_RESULT_51') === true;
  const sessionId = agent.sessionId;
  agent = await continueAgent(agent.id, 'Without calling any tools, repeat the file content you read in the previous turn only.', { config });
  checks.agentContinuation = agent.status === 'completed' && agent.sessionId === sessionId && agent.result?.includes('CCPT_READ_RESULT_51') === true;
  checks.persistedToolResult = JSON.stringify((await loadSession(sessionId)).messages).includes('CCPT_READ_RESULT_51');
  const controller = new AbortController(); let delta = false, cancelled = false;
  try {
    await withExecutionSignal(controller.signal, () => callModel(config, 'This is a cancellation test.', [{ role: 'user', content: 'Write a numbered list of 100 short facts about TypeScript.' }], [], { onTextDelta() { delta = true; controller.abort(); } }));
  } catch { cancelled = controller.signal.aborted; }
  checks.streamCancellation = delta && cancelled;
  console.log(JSON.stringify({ ok: Object.values(checks).every(Boolean), model: config.model.name, protocol: resolveModelProtocol(config.model), wireProtocol: resolveModelWireProtocol(config.model), checks }, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
} finally {
  if (priorHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = priorHome;
  await rm(root, { recursive: true, force: true });
}
