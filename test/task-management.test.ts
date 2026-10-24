import { expect, test } from 'bun:test';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { spawnAgent, continueAgent, loadAgent, saveAgent } from '../src/agent.js';
import { stopProjectTask, projectAgent } from '../src/taskManagement.js';
import { agentResourceItem, navigateResource, renderResourceDialog, type ResourceDialogState } from '../src/components/resourceDialog.js';
import type { AgentRecord } from '../src/types.js';

test('Agent actions require detail and explicit confirmation; escape, busy state, and terminal states are safe', () => {
  const agent = { id: 'agent_1111111111111111', sessionId: 'session_1111111111111111', status: 'working', role: 'coding', goal: 'Example', cwd: process.cwd() } as AgentRecord;
  const state: ResourceDialogState = { type: 'resource', kind: 'agents', title: 'Agents', query: '', selected: 0, tab: 0, tabs: ['Active'], groups: [[agentResourceItem(agent)]], expanded: true, cwd: process.cwd(), allProjects: false };
  expect(navigateResource(state, 'x', 'x')).toBeUndefined(); expect(state.confirmation?.action).toBe('stop');
  expect(renderResourceDialog(state, 120, 20).join('\n')).toContain('not reverted');
  navigateResource(state, 'escape'); expect(state.confirmation).toBeUndefined();
  navigateResource(state, 'a', 'a'); expect(state.confirmation?.action).toBe('attach');
  expect(renderResourceDialog(state, 120, 20).join('\n')).toContain('No model call');
  navigateResource(state, 'escape'); expect(state.confirmation).toBeUndefined();
  navigateResource(state, 'x', 'x'); state.busy = true; expect(navigateResource(state, 'return')).toBeUndefined(); state.busy = false;
  expect(navigateResource(state, 'return')).toBe('action');
  expect(agentResourceItem({ ...agent, status: 'completed' }).actions).toEqual(['attach']);
  expect(agentResourceItem({ ...agent, status: 'waiting_for_input' }).actions).toEqual(['stop', 'attach']);
});

test('workspace scope prevents foreign stops; cancellation survives stale worker saves and prevents subsequent tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-cancel-')); const previous = process.env.CCPT_HOME;
  process.env.CCPT_HOME = join(root, 'state');
  let release!: () => void; const gate = new Promise<void>(r => { release = r; }); let entered!: () => void; const requestStarted = new Promise<void>(r => { entered = r; });
  let calls = 0; let id = '';
  const server = Bun.serve({ port: 0, async fetch() {
    calls++; if (calls === 1) { entered(); await gate; return Response.json({ choices: [{ message: { tool_calls: [{ id: 'late', function: { name: 'write_file', arguments: JSON.stringify({ path: 'must-not-exist', content: 'late write' }) } }] } }] }); }
    return Response.json({ choices: [{ message: { content: 'Explicit continuation works' } }] });
  } });
  let run: Promise<AgentRecord> | undefined;
  try {
    const config = structuredClone(defaultConfig); config.model.endpointUrl = `http://127.0.0.1:${server.port}`; config.model.apiProtocol = 'chat-completions'; config.hooks = []; config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none';
    run = spawnAgent({ goal: 'Create a fixture', cwd: root, config, isolation: 'none', background: false, onEvent(event) { id = event.agentId; } });
    await requestStarted;
    await expect(projectAgent(join(root, 'another'), id)).rejects.toThrow('another workspace');
    await expect(stopProjectTask(join(root, 'another'), id)).rejects.toThrow('another workspace');
    const stale = structuredClone(await loadAgent(id));
    expect((await stopProjectTask(root, id)).status).toBe('cancelled');
    await saveAgent(stale); expect((await loadAgent(id)).status).toBe('cancelled');
    // Cancellation now aborts the socket; it need not wait for the server gate.
    expect((await Promise.race([run, Bun.sleep(3000).then(() => { throw new Error('Cancellation waited for the model response'); })])).status).toBe('cancelled');
    release();
    await expect(access(join(root, 'must-not-exist'))).rejects.toThrow(); expect(calls).toBe(1);
    expect((await continueAgent(id, 'Explicit next request', { config })).status).toBe('completed');
    expect((await stopProjectTask(root, id)).status).toBe('completed');
  } finally {
    release(); await run?.catch(() => {}); server.stop(true);
    if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous;
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
