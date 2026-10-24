import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeJson } from '../src/storage.js';
import { createProjectPlan } from '../src/plans.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

test('two real IDE bridge processes invalidate state and only one of 16 same-version decisions wins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-ide-live-'));
  await writeJson(join(root, '.ccpt/settings.json'), { marketplaceEnabled: false, disableBundledSkills: true, hooks: [] });
  const env: Record<string, string> = { CCPT_HOME: join(root, 'home') };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const start = () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../src/cli.ts'), 'ide', 'serve', '--cwd', root], { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    const messages: any[] = []; let buffer = '';
    const pump = (async () => { for await (const chunk of child.stdout) { buffer += new TextDecoder().decode(chunk); let line: number; while ((line = buffer.indexOf('\n')) >= 0) { const value = buffer.slice(0, line); buffer = buffer.slice(line + 1); messages.push(JSON.parse(value)); } } })();
    const errors = new Response(child.stderr).text();
    return { child, messages, pump, errors, send: (value: unknown) => { child.stdin.write(JSON.stringify(value) + '\n'); child.stdin.flush(); } };
  };
  const windows = [start(), start()];
  const until = async (fn: () => boolean) => { const deadline = Date.now() + 8000; while (!fn() && Date.now() < deadline) await Bun.sleep(20); expect(fn()).toBe(true); };
  try {
    for (const window of windows) window.send({ id: 1, method: 'project/watch' });
    await until(() => windows.every(window => window.messages.some(item => item.method === 'project/state')));
    const initial = windows.map(window => window.messages.find(item => item.method === 'project/state').params.revision);
    const plan = await createProjectPlan({ cwd: root, request: 'PRIVATE-PLAN-CONTENT', content: '# Private plan' });
    await until(() => windows.every((window, i) => window.messages.some(item => item.method === 'project/state' && item.params.revision !== initial[i])));
    for (const window of windows) for (let i = 0; i < 8; i++) window.send({ id: 100 + i, method: 'plan/decide', params: { id: plan.id, decision: 'approved', expectedVersion: plan.version } });
    await until(() => windows.every(window => window.messages.filter(item => item.id >= 100).length === 8));
    const decisions = windows.flatMap(window => window.messages.filter(item => item.id >= 100)); expect(decisions.filter(item => item.result)).toHaveLength(1);
    expect(decisions.filter(item => item.error)).toHaveLength(15);
    for (const window of windows) { expect(JSON.stringify(window.messages.filter(item => item.method === 'project/state'))).not.toContain('PRIVATE-PLAN'); window.send({ id: 2, method: 'project/watch', params: { enabled: false } }); }
    await until(() => windows.every(window => window.messages.some(item => item.id === 2 && item.result.watching === false)));
  } finally {
    for (const window of windows) window.child.stdin.end();
    for (const window of windows) { await Promise.race([window.child.exited, Bun.sleep(2000)]); window.child.kill(); await window.child.exited; await window.pump; await window.errors; }
    await removeOwnedTemporaryFixture(root);
  }
}, 20000);
