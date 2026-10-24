import { afterAll, beforeAll, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { defaultConfig } from '../src/config.js';
import { withFileLock, writeJson } from '../src/storage.js';
import { readUtf8Text } from '../src/textFiles.js';
import { executeTool } from '../src/tooling.js';
import { executeFileRead } from '../src/tools/FileReadTool/FileReadTool.js';
import { executeGlob } from '../src/tools/GlobTool/GlobTool.js';
import { executeGrep } from '../src/tools/GrepTool/GrepTool.js';
import { validateWorkflow, runWorkflow } from '../src/workflow.js';
import { expandCommand } from '../src/platform.js';
import type { ToolContext } from '../src/types.js';

let root: string, oldHome: string | undefined;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'ccpt-reliability-')); oldHome = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'state'); });
afterAll(async () => { if (oldHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = oldHome; await rm(root, { recursive: true, force: true }); });
async function context(): Promise<ToolContext> {
  const cwd = await mkdtemp(join(root, 'files-')); const config = structuredClone(defaultConfig);
  config.policy.workspaceRoots = [cwd]; config.hooks = []; config.marketplaceEnabled = false;
  return { cwd, config, agentId: 'agent_0000000000000001', sessionId: 'fixture-session', depth: 0 };
}

test('an old live lock is never stolen even after contender timeout', async () => {
  const path = join(root, 'live.lock'); let enter!: () => void, release!: () => void;
  const ready = new Promise<void>(resolve => { enter = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  const holding = withFileLock(path, async () => { enter(); await gate; });
  try {
    await ready; await utimes(path, new Date(0), new Date(0));
    let ran = false;
    await expect(withFileLock(path, async () => { ran = true; }, 90)).rejects.toThrow('Timed out acquiring');
    expect(ran).toBe(false); await access(path);
  } finally { release(); await holding; }
  await expect(access(path)).rejects.toThrow();
});

test('dead lock reclamation and concurrent updates remain exclusive', async () => {
  const path = join(root, 'dead.lock');
  const deadPid = Number(execFileSync('node', ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }));
  await writeJson(path, { pid: deadPid, createdAt: new Date().toISOString() });
  let value = 0, inside = 0, maximum = 0;
  await Promise.all(Array.from({ length: 12 }, () => withFileLock(path, async () => {
    inside++; maximum = Math.max(maximum, inside); const old = value; await Bun.sleep(5); value = old + 1; inside--;
  }, 5000)));
  expect(value).toBe(12); expect(maximum).toBe(1);
});

test('unknown owners fail closed and release never removes a replacement token', async () => {
  const path = join(root, 'unknown.lock'); await writeFile(path, '{invalid');
  await expect(withFileLock(path, async () => {}, 90)).rejects.toThrow('Timed out acquiring');
  expect(await readFile(path, 'utf8')).toBe('{invalid'); await rm(path);
  await withFileLock(path, async () => { await writeFile(path, JSON.stringify({ pid: process.pid, token: 'replacement', createdAt: new Date().toISOString() })); });
  expect(JSON.parse(await readFile(path, 'utf8')).token).toBe('replacement');
});

test('independent processes serialize read/modify/write against the same state lock', async () => {
  const path = join(root, 'counter.json'); await writeJson(path, { count: 0 });
  const module = pathToFileURL(join(import.meta.dir, '../src/storage.ts')).href;
  const script = `const {withFileLock,readJson,writeJson}=await import(${JSON.stringify(module)}); for(let i=0;i<6;i++) await withFileLock(${JSON.stringify(path + '.lock')},async()=>{const state=await readJson(${JSON.stringify(path)},null);await Bun.sleep(5);await writeJson(${JSON.stringify(path)},{count:state.count+1});},10000);`;
  const outcomes = await Promise.all(Array.from({ length: 3 }, async () => {
    const child = Bun.spawn([process.execPath, '-e', script], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' });
    const timer = setTimeout(() => child.kill(), 15000);
    try { return { error: await new Response(child.stderr).text(), code: await child.exited }; }
    finally { clearTimeout(timer); }
  }));
  expect(outcomes).toEqual([{ error: '', code: 0 }, { error: '', code: 0 }, { error: '', code: 0 }]);
  expect(JSON.parse(await readFile(path, 'utf8')).count).toBe(18);
}, 20000);

test('both read paths reject binary/invalid UTF-8 and preserve Chinese/emoji', async () => {
  const ctx = await context();
  const samples = [Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('PK\x03\x04\x00'), Buffer.from([0xff, 0xfe, 0x41, 0]), Buffer.from([0xc3, 0x28]), Buffer.from('unsafe\x1b[2J')];
  for (const [index, bytes] of samples.entries()) {
    const path = join(ctx.cwd, `binary-${index}`); await writeFile(path, bytes);
    await expect(readUtf8Text(path, 100)).rejects.toThrow('Not a UTF-8 text file');
    await expect(executeFileRead({ path: `binary-${index}` }, ctx)).rejects.toThrow('Not a UTF-8 text file');
    await expect(executeTool('read_file', { path: `binary-${index}` }, ctx, async () => '')).rejects.toThrow('Not a UTF-8 text file');
  }
  await writeFile(join(ctx.cwd, 'text.txt'), '\ufeff你好🙂\nsecond\tline\n');
  expect(await readUtf8Text(join(ctx.cwd, 'text.txt'), 100)).toContain('你好🙂');
  expect((await executeFileRead({ path: 'text.txt', offset: 1, limit: 1 }, ctx)).content).toBe('2\tsecond\tline');
  await expect(readUtf8Text(join(ctx.cwd, 'text.txt'), 2)).rejects.toThrow('read limit');
  await expect(readUtf8Text(ctx.cwd, 100)).rejects.toThrow();
});

test('search detects root-level files, skips known binary and surfaces real failures', async () => {
  const ctx = await context(); await mkdir(join(ctx.cwd, 'src'));
  await writeFile(join(ctx.cwd, 'root.txt'), 'needle at root'); await writeFile(join(ctx.cwd, 'src', 'deep.txt'), 'needle deep'); await writeFile(join(ctx.cwd, 'image.bin'), Buffer.from('needle\x00binary'));
  expect((await executeGlob({ pattern: '**/*.txt' }, ctx))).toEqual(['root.txt', 'src/deep.txt']);
  expect((await executeGrep({ query: 'needle' }, ctx)).map(item => item.path)).toEqual(['root.txt', 'src/deep.txt']);
  const literal = await executeTool('search_text', { query: 'needle', path: 'root.txt' }, ctx, async () => '');
  expect(literal.content).toContain('root.txt:1:needle');
  await expect(executeGrep({ query: 'needle', path: 'missing' }, ctx)).rejects.toThrow('ENOENT');
  await expect(executeTool('search_text', { query: 'needle', path: 'missing' }, ctx, async () => '')).rejects.toThrow('ENOENT');
  expect((await executeTool('search_text', { query: 'not-present' }, ctx, async () => '')).content).toBe('No matches');
});

test('numeric read/search bounds reject NaN, zero, negative and fractional inputs', async () => {
  const ctx = await context(); await writeFile(join(ctx.cwd, 'text.txt'), 'hello');
  for (const limit of [NaN, Infinity, 0, -1, 1.5]) {
    await expect(executeFileRead({ path: 'text.txt', limit }, ctx)).rejects.toThrow('limit');
    await expect(executeGrep({ query: 'hello', limit }, ctx)).rejects.toThrow('limit');
    await expect(executeGlob({ pattern: '**/*', limit }, ctx)).rejects.toThrow('limit');
    await expect(executeTool('search_text', { query: 'hello', limit }, ctx, async () => '')).rejects.toThrow('limit');
  }
  await expect(executeFileRead({ path: 'text.txt', offset: -1 }, ctx)).rejects.toThrow('offset');
});

test('workflow validates the entire graph before any worker or model can start', async () => {
  const ctx = await context();
  const invalid: unknown[] = [null, {}, { name: 'empty', tasks: [] }, { name: 'bad', tasks: [{ id: '../escape', goal: 'x' }] }, { name: 'bad', tasks: [{ id: 'a', goal: '' }] }, { name: 'bad', tasks: [{ id: 'a', goal: 'x', dependsOn: 'a' }] }, { name: 'bad', tasks: [{ id: 'a', goal: 'x', dependsOn: ['missing'] }] }, { name: 'bad', tasks: [{ id: 'a', goal: 'x' }, { id: 'a', goal: 'x' }] }, { name: 'cycle', tasks: [{ id: 'independent', goal: 'Must not start' }, { id: 'a', goal: 'x', dependsOn: ['b'] }, { id: 'b', goal: 'x', dependsOn: ['a'] }] }];
  for (const value of invalid) {
    expect(() => validateWorkflow(value)).toThrow();
    await expect(runWorkflow(value as any, ctx.cwd, ctx.config)).rejects.toThrow();
  }
  expect(() => validateWorkflow({ name: 'valid', tasks: [{ id: 'a', goal: 'A' }, { id: 'b', goal: 'B', dependsOn: ['a'] }] })).not.toThrow();
});

test('command expansion is bounded and inserted placeholders remain literal data', () => {
  const command = { name: 'test', description: 'fixture', prompt: 'Run {args} in {cwd}', plugin: 'fixture' };
  expect(expandCommand(command, '{cwd}', 'workspace')).toBe('Run {cwd} in workspace');
  expect(() => expandCommand({ ...command, prompt: '{args}'.repeat(1000) }, 'x'.repeat(1001), 'workspace')).toThrow('safety limit');
  expect(expandCommand({ ...command, prompt: '{args}' }, 'x'.repeat(1_000_000), '.').length).toBe(1_000_000);
  expect(() => expandCommand({ ...command, prompt: '{args}' }, '你'.repeat(333334), '.')).toThrow('safety limit');
});
