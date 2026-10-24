// Serial follow-up verification, retaining previous generated evidence before
// each legacy smoke writes its usual report. Candidate release files untouched.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile), project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(process.env.CCPT_VERIFICATION_OUTPUT ?? join(project, '.ccpt/verification-060-20261018'));
await mkdir(join(output, 'previous'), { recursive: true });
await mkdir(join(output, 'smokes'), { recursive: true });
const env = { ...process.env, CCPT_VERIFICATION_OUTPUT: join(output, 'boundaries') };
for (const name of Object.keys(env)) if (/^(CCPT_|ANTHROPIC_|OPENAI_|AZURE_OPENAI_)/.test(name) && name !== 'CCPT_VERIFICATION_OUTPUT') delete env[name];
const tasks = [
  ['recovery-boundaries', 'bun', ['scripts/verify-recovery-boundaries-060.ts'], null],
  ['node-goal', 'bun', ['scripts/verify-original-060.ts'], '.ccpt/original-060/final/node-goal-smoke.json'],
  ['node-guards', 'bun', ['scripts/verify-guards-060.ts'], '.ccpt/original-060/final/node-guards-smoke.json'],
  ['native-history', 'bun', ['scripts/verify-history-059.ts'], '.ccpt/platform-059/final/native-history-smoke.json'],
  ['ephemeral', 'bun', ['scripts/verify-ephemeral-059.ts'], '.ccpt/platform-059/final/ephemeral-smoke.json'],
  ['node-platform', 'bun', ['scripts/verify-platform-059.ts'], '.ccpt/platform-059/final/node-platform-smoke.json'],
  ['extension', process.execPath, ['scripts/verify-extension-059.mjs'], '.ccpt/platform-059/final/extension-smoke.json'],
  ['packed-types', 'bun', ['scripts/verify-packed-types.ts', 'releases/local-0.60.0-VmfPF1/ccpt-0.60.0.tgz'], '.ccpt/http-sdk-20261017/final/packed-types-smoke.json'],
];
const results = [];
for (const [id, runtime, args, report] of tasks) {
  if (report) try { await copyFile(join(project, report), join(output, 'previous', id + '.json')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const started = Date.now();
  console.log('START ' + id);
  let stdout = '', stderr = '', exitCode = 0;
  try { ({ stdout, stderr } = await run(runtime, args, { cwd: project, env, windowsHide: true, timeout: 120000, maxBuffer: 2_000_000 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? String(error); exitCode = typeof error.code === 'number' ? error.code : 1; }
  await writeFile(join(output, 'smokes', id + '.log'), stdout + stderr);
  let pass = exitCode === 0, acceptancePassed = pass;
  if (pass) {
    const path = report ? join(project, report) : join(output, 'boundaries/recovery-boundaries.json');
    const value = JSON.parse(await readFile(path, 'utf8'));
    await copyFile(path, join(output, 'smokes', id + '.json'));
    acceptancePassed = id === 'recovery-boundaries' ? value.allAcceptanceChecksPassed === true : value.pass === true;
    pass = id === 'recovery-boundaries' ? value.reproductionCompleted === true : value.pass === true;
  }
  results.push({ id, script: args[0], exitCode, verificationExecuted: pass, acceptancePassed, elapsedMs: Date.now() - started });
  console.log(JSON.stringify(results.at(-1)));
}
await writeFile(join(output, 'followup-summary.json'), JSON.stringify({ at: new Date().toISOString(), results, allScriptsExecuted: results.every(row => row.verificationExecuted), allAcceptancePassed: results.every(row => row.acceptancePassed), note: 'A successful defect reproduction is NOT a passed product acceptance check.' }, null, 2));
if (results.some(row => !row.verificationExecuted)) process.exitCode = 1;
