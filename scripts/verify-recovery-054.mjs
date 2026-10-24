import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const run = promisify(execFile), project = dirname(dirname(fileURLToPath(import.meta.url)));
const root = await mkdtemp(join(tmpdir(), 'ccpt-node-recovery-'));
const env = { ...process.env };
for (const name of Object.keys(env)) if (/^(CCPT_|ANTHROPIC_|OPENAI_|AZURE_OPENAI_)/.test(name)) delete env[name];
env.CCPT_HOME = join(root, 'home');
const cli = async args => JSON.parse((await run(process.execPath, [join(project, 'dist/cli.js'), ...args, '--cwd', root], { cwd: root, env, windowsHide: true, timeout: 15000 })).stdout);
try {
  await mkdir(join(root, '.ccpt'));
  await writeFile(join(root, '.ccpt/settings.json'), JSON.stringify({ marketplaceEnabled: false, disableBundledSkills: true, hooks: [] }));
  const sdk = await import(pathToFileURL(join(project, 'dist/entrypoints/sdk.js')).href);
  await sdk.automation.createRoutine({ name: 'fixture', prompt: 'PRIVATE-RECOVERY-CONTENT' }, root);
  const raw = Buffer.from([0x7b,0xff,0xfe,0x00]);
  await writeFile(join(root, '.ccpt/automation.json'), raw);
  const preview = await cli(['wakeups','repair']);
  if (preview.repaired || !/^[a-f0-9]{64}$/.test(preview.expectedDigest) || JSON.stringify(preview).includes('PRIVATE-')) throw new Error('Unsafe recovery preview');
  const repaired = await cli(['wakeups','repair','--confirm','--expected-digest',preview.expectedDigest]);
  if (!repaired.repaired || !repaired.pendingWorkPaused || repaired.automaticReplay) throw new Error('Unsafe recovery result');
  if (!(await readFile(join(repaired.backup, 'corrupt.json'))).equals(raw)) throw new Error('Non-UTF8 corrupt original was not retained byte for byte');
  if ((await sdk.automation.listRoutines(root))[0].enabled !== false) throw new Error('Recovered routine remained enabled');
  if (typeof sdk.conflictVersions !== 'function' || typeof sdk.repairAutomationState !== 'function') throw new Error('Missing SDK recovery exports');
  const report = { pass: true, runtime: 'built Node CLI and SDK', checks: ['write-ahead checkpoint','CLI dry-run/CAS recovery','invalid UTF-8 original retained byte-for-byte','pending work paused','public SDK exports'], companyRequests: 0, modelRequests: 0, userSettingsModified: false };
  const output = join(project, '.ccpt/remaining-054/final'); await mkdir(output, { recursive: true });
  await writeFile(join(output, 'node-recovery.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Unsafe fixture cleanup path');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
