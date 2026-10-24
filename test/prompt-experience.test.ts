import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { movePromptCursor, deletePromptGrapheme } from '../src/tui/terminalText.js';
import { stripAnsi, truncateTerminal, wrapTerminal } from '../src/tui/presentation.js';
import { stringWidth } from '../src/ink/stringWidth.js';
import { renderIdleHint, renderPromptPalette, renderShortcutHelp } from '../src/components/promptExperience.js';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { workspaceTrustKey } from '../src/workspaceTrust.js';

test('prompt movement and deletion preserve entire emoji, combining marks and Chinese characters', () => {
  for (const cluster of ['🙂', '👨‍👩‍👧‍👦', '👍🏽', 'e\u0301', '中', '🇨🇳']) {
    const input = `A${cluster}Z`;
    expect(movePromptCursor(input, 1, 1)).toBe(1 + cluster.length);
    expect(movePromptCursor(input, 1 + cluster.length, -1)).toBe(1);
    expect(deletePromptGrapheme(input, 1 + cluster.length, true)).toEqual({ text: 'AZ', cursor: 1 });
    expect(deletePromptGrapheme(input, 1, false)).toEqual({ text: 'AZ', cursor: 1 });
  }
  expect(deletePromptGrapheme('abc', 0, true).text).toBe('abc');
  expect(deletePromptGrapheme('abc', 3, false).text).toBe('abc');
});

test('terminal clipping and wrapping use display cells without splitting styled graphemes', () => {
  expect(truncateTerminal('你好世界', 5)).toBe('你好…');
  expect(truncateTerminal('🙂🙂🙂', 4)).toBe('🙂…');
  expect(truncateTerminal('x', 0)).toBe('');
  const styled = truncateTerminal('\u001b[31m你好世界\u001b[0m', 5);
  expect(stripAnsi(styled)).toBe('你好…'); expect(styled.endsWith('\u001b[0m')).toBe(true);
  const input = '中文👨‍👩‍👧‍👦e\u0301'.repeat(12);
  const lines = wrapTerminal(input, 11);
  expect(lines.every(line => stringWidth(line) <= 11)).toBe(true);
  expect(lines.join('')).toBe(input);
});

test('palette prioritizes descriptions and bounds long commands, usage and selection to terminal width', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ name: `/team:团队-${i}`, kind: 'command', argument: '[attach|wait|cancel|merge|cleanup] [id]', description: 'Inspect and manage running Agents' }));
  for (const width of [50, 79, 120]) {
    const lines = renderPromptPalette(items, 29, width, 7).map(stripAnsi);
    expect(lines.length).toBeLessThanOrEqual(7);
    expect(lines.every(line => stringWidth(line) <= width)).toBe(true);
    expect(lines.join('\n')).toContain('› /team:团队-29');
    expect(lines.join('\n')).toContain('Usage: /team:团队-29');
    expect(lines.join('\n')).toContain('30/30');
  }
  expect(renderPromptPalette([], 0, 80, 7)).toEqual([]);
});

test('idle status keeps permission and effort visible and shortcut help fits an 80-column terminal', () => {
  expect(renderIdleHint('Default', 'high', 79)).toBe('Default · high · ? shortcuts · / commands');
  expect(renderIdleHint('Restricted', 'xhigh', 50)).toContain('Restricted · xhigh');
  expect(renderShortcutHelp(79).every(line => stringWidth(line) <= 79)).toBe(true);
});

test('raw-key terminal: shortcut help is local, emoji editing reaches the model intact, palette still opens settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-prompt-experience-'));
  const state = join(root, 'state'); const requests: any[] = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    requests.push(await request.json());
    return Response.json({ choices: [{ message: { content: 'PROMPT-EDIT-OK' }, finish_reason: 'stop' }] });
  } });
  const config = structuredClone(defaultConfig);
  config.model.provider = 'compatible'; config.model.baseUrl = `http://127.0.0.1:${server.port}/v1`;
  config.network = { allowedHosts: ['127.0.0.1'], rejectUnauthorized: true, timeoutMs: 5000 };
  config.policy.workspaceRoots = [root]; config.agents.defaultIsolation = 'none';
  config.pluginDirectories = []; config.skillsDirectories = []; config.agentsDirectories = []; config.hooks = []; config.marketplaceEnabled = false;
  await writeJson(join(root, '.ccpt', 'settings.json'), config); await writeJson(join(state, 'settings.json'), config);
  await writeJson(join(state, 'workspace-trust.json'), { version: 1, workspaces: { [workspaceTrustKey(root)]: { trustedAt: new Date().toISOString() } } });
  const entry = pathToFileURL(resolve(import.meta.dir, '../src/tui.ts')).href;
  const script = `Object.defineProperty(process.stdin,'isTTY',{value:true}); process.stdin.setRawMode=()=>process.stdin; Object.defineProperty(process.stdout,'columns',{value:80}); Object.defineProperty(process.stdout,'rows',{value:24}); const {runTui}=await import(${JSON.stringify(entry)}); await runTui(process.cwd(),'fixture'); process.exit(0);`;
  const env: Record<string, string> = { CCPT_HOME: state, CCPT_API_KEY: 'fixture-only', CCPT_CLI_ENTRY: resolve(import.meta.dir, '../src/cli.ts'), NO_COLOR: '1' };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
  const child = Bun.spawn([process.execPath, '-e', script], { cwd: root, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  let output = '';
  const collect = async (stream: ReadableStream<Uint8Array>) => { const decoder = new TextDecoder(); for await (const chunk of stream) output += decoder.decode(chunk, { stream: true }); output += decoder.decode(); };
  const pumps = Promise.all([collect(child.stdout), collect(child.stderr)]);
  const until = async (marker: string) => { const deadline = Date.now() + 15000; while (!output.includes(marker) && Date.now() < deadline) await Bun.sleep(30); expect(output, `Missing ${marker}`).toContain(marker); output = ''; };
  const send = (keys: string) => { child.stdin.write(keys); child.stdin.flush(); };
  try {
    await until('/model to change'); send('?'); await until('Default shortcuts'); send('\r'); await until('? shortcuts'); expect(requests).toHaveLength(0);
    send('?'); await until('Default shortcuts'); send('你好🙂X'); await until('你好🙂X');
    send('\u001b[D\u007f'); await until('你好X'); send('\r'); await until('PROMPT-EDIT-OK');
    expect(requests).toHaveLength(1);
    expect(requests[0].messages.some((message: any) => message.role === 'user' && message.content === '你好X')).toBe(true);
    send('/con'); await until('Usage: /config'); send('\t'); await until('> /config'); send('\r'); await until('Type to filter');
    expect(requests).toHaveLength(1); send('\u001b'); await until('Space change'); send('\u001b'); await until('Unsaved changes were discarded');
    send('/exit\r'); await Promise.race([child.exited, Bun.sleep(3000)]);
  } finally { child.kill(); await child.exited; await pumps; server.stop(true); await rm(root, { recursive: true, force: true }); }
}, 30000);
