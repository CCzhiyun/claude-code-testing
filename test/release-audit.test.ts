import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';
// Production gate is Node ESM, not a Bun-only implementation.
const script = join(import.meta.dir, '../scripts/release-audit.mjs');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-release-audit-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'owned-fixture-only', version: '1.0.0', license: 'UNLICENSED' }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/fixture': { version: '1.0.0', license: 'MIT', integrity: 'fixture-hash' } } }));
  await mkdir(join(root, 'dist/types/src/entrypoints'), { recursive: true }); await writeFile(join(root, 'dist/cli.js'), 'export {};'); await writeFile(join(root, 'dist/types/src/entrypoints/sdk.d.ts'), 'export {};');
  await writeFile(join(root, 'NOTICE'), 'Fixture-owned test artifact only. Not an approval of project redistribution.');
  return root;
}
async function audit(root: string, check = false) {
  const child = Bun.spawn(['node', script, '--root', root, ...(check ? ['--check', '--registry', 'https://registry.fixture.invalid/'] : [])], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { code, stderr, value: JSON.parse(stdout) };
}
async function approveFixture(root: string) {
  const inventory = (await audit(root)).value;
  await writeFile(join(root, 'distribution-review.json'), JSON.stringify({ schemaVersion: 1, approved: true, inventoryDigest: inventory.digest, reviewedBy: 'Isolated fixture only', reviewedAt: new Date().toISOString(), distributionScope: 'internal', approvedRegistry: 'https://registry.fixture.invalid/', sourceRightsEvidence: ['Fixture created for this test; not a production license approval'], dependenciesReviewed: true, noticeReviewed: true }));
}
test('release gate defaults to blocked and dependency license claims do not create source redistribution rights', async () => {
  const root = await fixture();
  try { const result = await audit(root, true); expect(result.code).toBe(2); expect(result.value.approved).toBe(false); expect(result.value.isLegalAuthorization).toBe(false); expect(result.value.blockers.join(' ')).toContain('approval'); }
  finally { await removeOwnedTemporaryFixture(root); }
});
test('fixture approvals are bound to source/build/dependency bytes and reviewed registry', async () => {
  const root = await fixture();
  try {
    await approveFixture(root); expect((await audit(root, true)).value.approved).toBe(true);
    await writeFile(join(root, 'dist/cli.js'), 'export const changed=true;'); expect((await audit(root, true)).value.approved).toBe(false);
    await approveFixture(root);
    const approval = JSON.parse(await readFile(join(root, 'distribution-review.json'), 'utf8')); approval.approvedRegistry = 'https://different.invalid/'; await writeFile(join(root, 'distribution-review.json'), JSON.stringify(approval));
    expect((await audit(root, true)).value.blockers.join(' ')).toContain('registry');
  } finally { await removeOwnedTemporaryFixture(root); }
});
test('private key material is never approved by a stale or permissive release review', async () => {
  const root = await fixture();
  try { await writeFile(join(root, 'dist/key.txt'), '-----BEGIN PRIVATE KEY-----\nfixture-only-not-a-real-key\n-----END PRIVATE KEY-----'); await approveFixture(root); const result = await audit(root, true); expect(result.value.approved).toBe(false); expect(result.value.blockers.join(' ')).toContain('Private-key'); expect(JSON.stringify(result.value)).not.toContain('fixture-only-not-a-real-key'); }
  finally { await removeOwnedTemporaryFixture(root); }
});
