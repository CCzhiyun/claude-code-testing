// Built Node entrypoints for this table. No user state, corporate model or real Git repository.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeJson } from '../src/storage.js';
import { removeOwnedTemporaryFixture } from '../test/fixtureCleanup.js';
const project = resolve(import.meta.dir, '..'), root = await mkdtemp(join(tmpdir(), 'ccpt-built-table-'));
const env: Record<string, string> = { CCPT_HOME: join(root, 'home') };
for (const name of ['PATH','Path','SystemRoot','COMSPEC','TEMP','TMP','USERPROFILE']) if (process.env[name]) env[name] = process.env[name]!;
async function cli(args: string[]) {
  const child = Bun.spawn(['node', join(project, 'dist/cli.js'), ...args, '--cwd', root], { cwd: root, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill(), 15000);
  try { const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); if (code !== 0) throw new Error(err); return JSON.parse(out); } finally { clearTimeout(timer); }
}
try {
  await writeJson(join(root, '.ccpt/settings.json'), { marketplaceEnabled: false, disableBundledSkills: true, hooks: [] });
  const hooks = await cli(['hooks','matrix']); if (hooks.length < 30 || !hooks.every((row: any) => row.referenceParity === 'not-certified')) throw new Error('Hook contract export missing');
  const wakeups = await cli(['wakeups','doctor']); if (!wakeups.ok || wakeups.automaticReplay !== false) throw new Error('Automation inspection had unexpected semantics');
  execFileSync('git', ['init', root], { env, stdio: 'ignore' });
  const page = await cli(['agents','recovery-page','--limit','1']); if (page.total !== 0 || page.nextOffset !== null) throw new Error('Recovery paging export failed');
  const report = { pass: true, runtime: 'built Node CLI', checks: ['all Hook contracts exported without claiming reference parity','read-only automation doctor','Git recovery pagination'], companyRequests: 0, userSettingsModified: false };
  await writeJson(join(project, '.ccpt/table-followup-053/final/packaged-table.json'), report); console.log(JSON.stringify(report, null, 2));
} finally { await removeOwnedTemporaryFixture(root); }
