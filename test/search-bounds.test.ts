import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundedWorkspaceFiles, globMatcher } from '../src/boundedWalk.js';
import { defaultConfig } from '../src/config.js';
import { withExecutionSignal } from '../src/executionControl.js';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

test('glob DP preserves root/globstar/literal/case semantics and handles adversarial wildcard repetition', () => {
  for (const [pattern, path, expected] of [['**/*.ts','file.ts',true],['**/*.ts','src/deep/file.TS',true],['a/**/b','a/b',true],['a/**/b','a/x/y/b',true],['a/*/b','a/x/y/b',false],['a?.ts','ab.ts',true],['a[1].ts','a[1].ts',true],['**/*.ts','file.js',false]] as const) expect(globMatcher(pattern)(path)).toBe(expected);
  const started = Date.now(); expect(globMatcher('*a'.repeat(200) + 'b')('a'.repeat(500))).toBe(false); expect(Date.now() - started).toBeLessThan(1000);
});

test('enumeration deadline and cancellation apply before regex matching or any match exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-search-budget-')), config = structuredClone(defaultConfig); config.policy.workspaceRoots = [root];
  try {
    await mkdir(join(root, 'nested')); await writeFile(join(root, 'nested/file.txt'), 'x');
    await expect(boundedWorkspaceFiles(root, config, { limit: 20, deadlineAt: Date.now() - 1, accepts: () => false })).rejects.toThrow('time limit');
    const controller = new AbortController(); controller.abort(); await expect(withExecutionSignal(controller.signal, () => boundedWorkspaceFiles(root, config, { limit: 20 }))).rejects.toThrow();
    expect((await boundedWorkspaceFiles(root, config, { limit: 1 })).length).toBe(1);
  } finally { await removeOwnedTemporaryFixture(root); }
});
