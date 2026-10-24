// Run the normal test command with a fresh home, without changing the caller's settings.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const project = resolve(import.meta.dir, '..');
const root = await mkdtemp(join(tmpdir(), 'ccpt-single-regression-'));
if (!root.startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture directory');
const output = process.env.CCPT_REGRESSION_OUTPUT ? resolve(process.env.CCPT_REGRESSION_OUTPUT) : join(project, '.ccpt/story-fixes-20261016/evidence'); await mkdir(output, { recursive: true });
const env = { ...process.env }; for (const key of Object.keys(env)) if (/^(CCPT_|ANTHROPIC_|OPENAI_|AZURE_OPENAI_)/.test(key)) delete env[key];
env.CCPT_HOME = join(root, 'home');
const started = Date.now();
try {
  const child = Bun.spawn([process.execPath, 'test', './test'], { cwd: project, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  // Expanded persistence/OS-runner regression performs more real disk/process I/O.
  // Bound the expanded suite at 15 minutes; individual deadlines are unchanged.
  const timeout = setTimeout(() => child.kill(), 900000);
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); clearTimeout(timeout);
  const log = stdout + stderr; await writeFile(join(output, 'single-process-regression.log'), log);
  const summary = { testIsolation: 'one Bun process, fresh user state', exitCode, pass: Number(log.match(/\b(\d+) pass\b/)?.[1] ?? 0), fail: Number(log.match(/\b(\d+) fail\b/)?.[1] ?? 0), elapsedMs: Date.now() - started };
  await writeFile(join(output, 'single-process-regression.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary, null, 2));
  if (exitCode !== 0) process.exitCode = 1;
} finally { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
