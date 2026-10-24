// Synthetic local performance evidence only, not an enterprise-repository certification.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { boundedWorkspaceFiles, globMatcher } from '../src/boundedWalk.js';
import { defaultConfig } from '../src/config.js';
import { BoundedRegexMatcher } from '../src/regexWorker.js';
import { removeOwnedTemporaryFixture } from '../test/fixtureCleanup.js';
import { writeJson } from '../src/storage.js';
const root = await mkdtemp(join(tmpdir(), 'ccpt-large-search-')), count = 5000;
const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root];
try {
  for (let directory = 0; directory < 50; directory++) {
    const path = join(root, 'module-' + directory); await mkdir(path);
    await Promise.all(Array.from({ length: 100 }, (_, file) => writeFile(join(path, file + '.ts'), 'export const value = "fixture";\n')));
  }
  const matches = globMatcher('**/*.ts'), started = Date.now();
  const files = await boundedWorkspaceFiles(root, config, { limit: 10000, accepts: path => matches(relative(root, path).replaceAll('\\', '/')) });
  if (files.length !== count) throw new Error('Fixture enumeration incomplete');
  const elapsed = Date.now() - started; const worker = new BoundedRegexMatcher('(a+)+$', 100); let regexStopped = false;
  try { await worker.match('a'.repeat(100000) + '!', 1); } catch { regexStopped = true; } finally { await worker.close(); }
  if (!regexStopped) throw new Error('Pathological regex was not bounded');
  const report = { pass: true, scope: 'synthetic local Windows fixture; not 1M context or real enterprise repository acceptance', files: files.length, elapsedMs: elapsed, regexStopped, limits: { entries: 20000, depth: 64, deadlineMs: 10000 }, modelRequests: 0 };
  await writeJson(join(import.meta.dir, '../.ccpt/table-followup-053/search-benchmark.json'), report); console.log(JSON.stringify(report, null, 2));
} finally { await removeOwnedTemporaryFixture(root); }
