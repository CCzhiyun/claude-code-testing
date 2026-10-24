import { mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runHooks } from '../src/hooks.js';
import { defaultConfig } from '../src/config.js';
import { writeJson } from '../src/storage.js';
import { removeOwnedTemporaryFixture } from '../test/fixtureCleanup.js';
const root = await mkdtemp(join(tmpdir(), 'ccpt-hook-once-dispatch-'));
const previousHome = process.env.CCPT_HOME; process.env.CCPT_HOME = join(root, 'home');
let calls = 0;
const server = Bun.serve({ port: 0, fetch: () => { calls++; return Response.json({ additionalContext: 'fixture context' }); } });
try {
  const config = structuredClone(defaultConfig);
  config.hooks = [{ event: 'Setup', type: 'http', url: `http://127.0.0.1:${server.port}/hook`, once: true }];
  const results = await Promise.all(Array.from({ length: 8 }, () => runHooks(config, 'Setup', { sessionId: 'fixture-session' }, root)));
  if (calls !== 1 || results.flatMap(result => result.additionalContext).length !== 1) throw new Error('Hook dispatcher once contract failed');
  const report = { pass: true, checks: ['real runHooks dispatcher','eight concurrent invocations, one HTTP fixture call','one additionalContext contribution'], companyRequests: 0, modelRequests: 0 };
  await writeJson(join(resolve(import.meta.dir, '..'), '.ccpt/remaining-054/final/hooks-dispatcher.json'), report);
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.stop(true);
  if (previousHome === undefined) delete process.env.CCPT_HOME; else process.env.CCPT_HOME = previousHome;
  await removeOwnedTemporaryFixture(root);
}
