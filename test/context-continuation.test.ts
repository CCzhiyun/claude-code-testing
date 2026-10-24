import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { spawnAgent, continueAgent } from '../src/agent.js';
import { loadSession, fullSessionMessages } from '../src/sessions.js';
import { loadTask } from '../src/tasks.js';
import { writeJson } from '../src/storage.js';

test('unshrinkable context preserves a resumable Agent/session instead of ending the conversation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-context-continue-')); const previous = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'state');
  let requests = 0;
  const server = Bun.serve({ port: 0, fetch() { requests++; return Response.json({ choices: [{ message: { content: 'CONTINUED_SAME_SESSION' }, finish_reason: 'stop' }] }); } });
  try {
    const config = structuredClone(defaultConfig); config.marketplaceEnabled = false;
    config.model.apiProtocol = 'chat-completions'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`; config.model.maxContextTokens = 4000; config.model.maxOutputTokens = 100;
    config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none';
    await writeJson(join(root, '.ccpt', 'settings.json'), config);
    const events: string[] = []; const goal = 'Analyze: ' + '原'.repeat(10000);
    const paused = await spawnAgent({ goal, cwd: root, config, allowedTools: [], background: false, isolation: 'none', onEvent(event) { events.push(event.type); } });
    expect(paused.status).toBe('waiting_for_input'); expect(paused.error).toBeUndefined(); expect(paused.result).toContain('Conversation preserved'); expect(requests).toBe(0);
    expect(events).not.toContain('agent_failed'); expect((await loadTask(paused.taskId!)).status).toBe('blocked');
    expect(fullSessionMessages(await loadSession(paused.sessionId))[0]?.content).toBe(goal);
    config.model.maxContextTokens = 128000; await writeJson(join(root, '.ccpt', 'settings.json'), config);
    const resumed = await continueAgent(paused.id, 'Continue the original task with a concise answer.', { config });
    expect(resumed.id).toBe(paused.id); expect(resumed.sessionId).toBe(paused.sessionId); expect(resumed.status).toBe('completed'); expect(resumed.result).toBe('CONTINUED_SAME_SESSION'); expect(requests).toBe(1);
    expect(fullSessionMessages(await loadSession(resumed.sessionId))[0]?.content).toBe(goal);
  } finally { server.stop(true); if (previous === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previous; await rm(root, { recursive: true, force: true }); }
}, 15000);
