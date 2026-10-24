// One fresh Bun process and user-state directory per test file.
// Test outcomes are not modified; only accidental access to personal state is isolated.
import { mkdtemp, readdir, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const project = resolve(import.meta.dir, '..');
const output = process.env.CCPT_REGRESSION_OUTPUT ? resolve(process.env.CCPT_REGRESSION_OUTPUT) : resolve(project, '.ccpt/audit-20261016/isolated-regression');
const workers=Number(process.env.CCPT_REGRESSION_WORKERS??2);
if(!Number.isSafeInteger(workers)||workers<1||workers>2)throw new Error('CCPT_REGRESSION_WORKERS must be 1 or 2; test contents are unchanged');
const root = await mkdtemp(join(tmpdir(), 'ccpt-isolated-regression-'));
if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid test-state root');
const files = (await readdir(join(project, 'test'))).filter(name => name.endsWith('.test.ts')).sort();
const filter = process.argv.slice(2);
const selected = filter.length ? files.filter(name => filter.some(pattern => name.includes(pattern))) : files;
await mkdir(output, { recursive: true });
const results: Array<{ file: string; exitCode: number; pass: number; fail: number; skip: number; assertions: number; elapsedMs: number; log: string }> = [];
let cursor = 0;
try {
  await Promise.all(Array.from({ length: workers }, async () => {
    for (;;) {
      const file = selected[cursor++]; if (!file) break;
      const env = { ...process.env };
      for (const name of Object.keys(env)) if (/^(ANTHROPIC_|OPENAI_|AZURE_OPENAI_|CCPT_)/.test(name)) delete env[name];
      env.CCPT_HOME = join(root, file, 'state');
      const started = Date.now();
      // This suite includes fsync-heavy multi-Agent workflows and several cold
      // source-CLI launches per test. A 5 s unit default timed out on Windows,
      // allowing still-running fixture work to outlive its state directory.
      // Give integration work 20 s; explicit per-test deadlines and every
      // product/network/cancellation assertion remain unchanged.
      const child = Bun.spawn([process.execPath, 'test', '--timeout', '20000', join('test', file)], {
        cwd: project, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      });
      const timeout = setTimeout(() => child.kill(), 180_000);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      clearTimeout(timeout);
      const text = stdout + stderr;
      const log = join(output, file + '.log'); await writeFile(log, text);
      const result = { file, exitCode, pass: Number(text.match(/\b(\d+) pass\b/)?.[1] ?? 0),
        fail: Number(text.match(/\b(\d+) fail\b/)?.[1] ?? 0), skip: Number(text.match(/\b(\d+) skip\b/)?.[1] ?? 0), assertions: Number(text.match(/\b(\d+) expect\(\) calls\b/)?.[1] ?? 0), elapsedMs: Date.now() - started, log };
      results.push(result);
      console.log(JSON.stringify({ ...result, log: undefined }));
    }
  }));
  results.sort((a, b) => a.file.localeCompare(b.file));
  const report = { isolatedProcesses: true, workers, modelRequests: 'fixtures only', testFiles: selected.length,
    pass: results.reduce((sum, row) => sum + row.pass, 0), fail: results.reduce((sum, row) => sum + row.fail, 0),
    skip: results.reduce((sum,row)=>sum+row.skip,0), assertions: results.reduce((sum,row)=>sum+row.assertions,0),
    failingFiles: results.filter(row => row.exitCode !== 0).map(row => row.file), results };
  await writeFile(join(output, 'summary.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
  if (report.failingFiles.length) process.exitCode = 1;
} finally {
  // Only the validated directory created above; personal settings are never changed.
  await rm(root, { recursive: true, force: true });
}
