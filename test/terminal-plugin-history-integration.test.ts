import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { workspaceTrustKey } from '../src/workspaceTrust.js';
import { installTrustedPlugin, replaceInstalledPlugin, listPluginHistory } from '../src/pluginHistory.js';
import { loadPluginAt } from '../src/plugins.js';

test('raw-key terminal requires confirmation, restores plugin bytes and reloads without model calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-tui-plugin-')), state = join(root, 'state'), previousHome = process.env.CCPT_HOME;
  process.env.CCPT_HOME = state; let calls = 0;
  const server = Bun.serve({ port: 0, fetch: () => { calls++; return Response.json({ choices: [{ message: { content: 'should-not-run' } }] }); } });
  const config = structuredClone(defaultConfig); config.marketplaceEnabled = false; config.hooks = [];
  config.model.endpointUrl = `http://127.0.0.1:${server.port}/model`; config.model.apiProtocol = 'chat-completions'; config.policy.workspaceRoots = [root];
  await writeJson(join(root, '.ccpt', 'settings.json'), config); await writeJson(join(state, 'settings.json'), config);
  await writeJson(join(state, 'workspace-trust.json'), { version: 1, workspaces: { [workspaceTrustKey(root)]: { trustedAt: new Date().toISOString() } } });
  const v1 = join(root, 'v1'), v2 = join(root, 'v2');
  await writeJson(join(v1, 'plugin.json'), { name: 'team', version: '1.0.0' }); await writeJson(join(v2, 'plugin.json'), { name: 'team', version: '2.0.0' });
  const installed = await installTrustedPlugin(root, v1), updated = await replaceInstalledPlugin(root, 'team', 'project', v2);
  const entry = pathToFileURL(resolve(import.meta.dir, '../src/tui.ts')).href;
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); process.stdin.setRawMode=()=>process.stdin; Object.defineProperty(process.stdout,'columns',{value:140}); Object.defineProperty(process.stdout,'rows',{value:48}); const {runTui}=await import(${JSON.stringify(entry)}); await runTui(process.cwd(),'fixture'); process.exit(0);`;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: root, env: { ...process.env, CCPT_HOME: state, CCPT_API_KEY: 'fixture-only', DISABLE_AUTOUPDATER: '1', NO_COLOR: '1' }, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let output = '';
  const collect = async (stream: ReadableStream<Uint8Array>) => { for await (const chunk of stream) output += new TextDecoder().decode(chunk); };
  const pumps = Promise.all([collect(child.stdout), collect(child.stderr)]);
  const until = async (marker: string) => { const deadline = Date.now() + 10000; while (!output.includes(marker) && Date.now() < deadline) await Bun.sleep(20); expect(output.includes(marker), `Missing ${marker}\n${output.slice(-5000)}`).toBe(true); output = ''; };
  const send = (text: string) => { child.stdin.write(text); child.stdin.flush(); };
  try {
    await until('/model to change'); send('/plugin history team\r'); await until(updated.previous.id);
    send(`/plugin rollback team ${updated.previous.id}\r`); await until('Usage: /plugin rollback'); expect((await loadPluginAt(installed)).version).toBe('2.0.0');
    send(`/plugin rollback team ${updated.previous.id} confirm\r`); await until('Restored team 2.0.0'); expect((await loadPluginAt(installed)).version).toBe('1.0.0');
    send('/reload-plugins\r'); await until('Reloaded'); send('/plugin list\r'); await until('1.0.0');
    expect((await listPluginHistory(root, 'team')).length).toBe(2); expect(calls).toBe(0);
    send('/exit\r'); expect(await Promise.race([child.exited, Bun.sleep(5000).then(() => -99)])).toBe(0);
  } finally { child.kill(); await child.exited; await pumps; server.stop(true); if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome; await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}, 45000);
