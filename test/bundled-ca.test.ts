import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, cp, copyFile, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rootCertificates } from 'node:tls';
import { X509Certificate, createHash } from 'node:crypto';
import { removeOwnedTemporaryFixture } from './fixtureCleanup.js';

test('CA build embeds validated public certificates, runtime verifies hash, normal rebuild removes generated copies only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccpt-ca-build-'));
  try {
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'src', 'entrypoints'), { recursive: true });
  await copyFile(resolve(import.meta.dir, '../scripts/build.mjs'), join(root, 'scripts', 'build.mjs'));
  // Exercise the real declaration stage, not a stub compiler or an optional skip.
  await cp(resolve(import.meta.dir, '../node_modules/typescript'), join(root, 'node_modules/typescript'), { recursive: true });
  await writeFile(join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', types: ['node'], typeRoots: [resolve(import.meta.dir, '../node_modules/@types')], allowImportingTsExtensions: true } }));
  await copyFile(resolve(import.meta.dir, '../tsconfig.declarations.json'), join(root, 'tsconfig.declarations.json'));
  await copyFile(resolve(import.meta.dir, '../src/bundledCa.ts'), join(root, 'src', 'bundledCa.ts'));
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'src', 'cli.ts'), 'import {bundledCaFile} from "./bundledCa.ts"; console.log(bundledCaFile() ?? "NO_CA");');
  for (const entry of ['sdk', 'mcp']) await writeFile(join(root, 'src', 'entrypoints', `${entry}.ts`), 'import {bundledCaFile} from "../bundledCa.ts"; console.log(bundledCaFile() ?? "NO_CA");');
  const pem = rootCertificates.find((value) => { const cert = new X509Certificate(value); return cert.ca && Date.parse(cert.validFrom) < Date.now() && Date.parse(cert.validTo) > Date.now(); });
  expect(pem).toBeDefined();
  await writeFile(join(root, 'public.pem'), pem!);
  await writeFile(join(root, 'private.pem'), '-----BEGIN PRIVATE KEY-----\nnot-a-certificate\n-----END PRIVATE KEY-----');
  const run = async (args: string[], env: Record<string, string> = {}) => {
    const child = Bun.spawn(['node', ...args], { cwd: root, env: { ...process.env, CCPT_DISABLE_BUNDLED_CA: '', ...env }, stdout: 'pipe', stderr: 'pipe' });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return { code, out, err };
  };
  const rejected = await run(['scripts/build.mjs', '--ca-file', 'private.pem']); expect(rejected.code).not.toBe(0); expect(rejected.err).toContain('public CA');
  const built = await run(['scripts/build.mjs', '--ca-file', 'public.pem']); expect(built.code, built.err).toBe(0);
  await access(join(root, 'dist/types/src/entrypoints/sdk.d.ts'));
  const embedded = await readFile(join(root, 'dist', 'certs', 'company-ca.pem'));
  const manifest = JSON.parse(await readFile(join(root, 'dist', 'certs', 'company-ca.json'), 'utf8'));
  expect(manifest.sha256).toBe(createHash('sha256').update(embedded).digest('hex'));
  for (const entry of ['cli.js', 'entrypoints/sdk.js', 'entrypoints/mcp.js']) {
    const check = await run([`dist/${entry}`]); expect(check.code, check.err).toBe(0); expect(check.out).toContain('company-ca.pem');
  }
  expect((await run(['dist/cli.js'], { CCPT_DISABLE_BUNDLED_CA: '1' })).out.trim()).toBe('NO_CA');
  await writeFile(join(root, 'dist', 'certs', 'company-ca.pem'), 'tampered');
  const tampered = await run(['dist/cli.js']); expect(tampered.code).not.toBe(0); expect(tampered.err).toContain('integrity');
  const rebuilt = await run(['scripts/build.mjs']); expect(rebuilt.code, rebuilt.err).toBe(0);
  expect((await run(['dist/cli.js'])).out.trim()).toBe('NO_CA');
  await expect(access(join(root, 'dist', 'certs', 'company-ca.pem'))).rejects.toThrow();
  expect(await readFile(join(root, 'public.pem'), 'utf8')).toBe(pem!);
  } finally { await removeOwnedTemporaryFixture(root); }
}, 30_000);
