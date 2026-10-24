// Real Git + distributable Node CLI. No model server, keys or external network.
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { createWorktree, removeWorktree } from '../src/worktree.js';
import { writeJson } from '../src/storage.js';

const project = resolve(import.meta.dir, '..');
const container = await mkdtemp(join(tmpdir(), 'ccpt-packaged-recovery-'));
const oldHome = process.env.CCPT_HOME;
process.env.CCPT_HOME = join(container, 'state');
const env = { ...process.env };
for (const name of Object.keys(env)) if (/^(CCPT_|OPENAI_|ANTHROPIC_|AZURE_OPENAI_)/.test(name)) delete env[name];
env.CCPT_HOME = process.env.CCPT_HOME;
const repo = join(container, 'repo');
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
async function cli(...args: string[]) {
  const child = Bun.spawn(['node', join(project, 'dist/cli.js'), ...args, '--cwd', repo], { cwd: repo, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => child.kill(), 15000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, code };
  } finally { clearTimeout(timer); }
}
try {
  execFileSync('git', ['init', repo], { stdio: 'ignore' });
  git('config', 'user.name', 'CCPT Fixture'); git('config', 'user.email', 'fixture@ccpt.local');
  await writeFile(join(repo, 'base.txt'), 'base'); git('add', 'base.txt'); git('commit', '-m', 'initial fixture');
  const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [repo]; config.hooks = []; config.marketplaceEnabled = false;
  await writeJson(join(repo, '.ccpt', 'settings.json'), config);
  const id = 'agent_7777777777777777';
  const target = await createWorktree(repo, id, config); await writeFile(join(target, 'saved.txt'), 'Retain packaged recovery evidence');
  await removeWorktree(repo, target, config);
  const listing = await cli('agents', 'recovery-list');
  if (listing.code !== 0) throw new Error(listing.stderr);
  const retained = JSON.parse(listing.stdout) as Array<{ ref: string; commit: string }>;
  const saved = retained.find(item => item.ref.includes(id));
  if (!saved || git('show', `${saved.commit}:saved.txt`) !== 'Retain packaged recovery evidence') throw new Error('Packaged CLI did not expose the retained commit');
  const activeId = 'agent_8888888888888888'; const activeTarget = await createWorktree(repo, activeId, config);
  const now = new Date().toISOString();
  await writeJson(join(container, 'state', 'agents', `${activeId}.json`), { id: activeId, sessionId: 'fixture-session', cwd: repo, worktree: activeTarget, status: 'working', goal: 'Do not remove an active workspace', role: 'lead', depth: 0, createdAt: now, updatedAt: now });
  const refused = await cli('agents', 'cleanup', activeId);
  if (refused.code === 0 || !refused.stderr.includes('Stop or finish the Agent')) throw new Error('Packaged CLI did not reject active cleanup');
  await access(activeTarget);
  const report = { pass: true, entrypoint: 'node dist/cli.js', checks: ['recovery-list returns retained commit', 'saved content recoverable', 'active Agent cleanup refused', 'active directory preserved'], modelRequests: 0, networkRequests: 0, userSettingsModified: false };
  await writeJson(join(project, '.ccpt/reliability-20261017/final/packaged-recovery-smoke.json'), report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (oldHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = oldHome;
  if (!resolve(container).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture cleanup target');
  await rm(container, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
