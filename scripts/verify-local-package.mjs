// Offline npm installation into an owned temporary prefix. Never touches real global packages.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile), project = dirname(dirname(fileURLToPath(import.meta.url)));
const archive = process.argv[2];
if (!archive?.endsWith('.tgz')) throw new Error('Usage: npm run verify:package -- <local .tgz>');
const npmCli = process.env.npm_execpath;
if (!npmCli || !/[\\/]npm-cli\.js$/i.test(npmCli)) throw new Error('Run through npm run verify:package so the installed npm CLI is selected');
await access(npmCli);
const root = await mkdtemp(join(tmpdir(), 'ccpt-offline-package-'));
try {
  const env = { CCPT_HOME: join(root, 'state'), HOME: root, USERPROFILE: root, APPDATA: join(root, 'appdata'), npm_config_userconfig: join(root, 'npmrc'), npm_config_globalconfig: join(root, 'global-npmrc') };
  for (const name of ['PATH', 'Path', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP']) if (process.env[name]) env[name] = process.env[name];
  await writeFile(env.npm_config_userconfig, ''); await writeFile(env.npm_config_globalconfig, '');
  const prefix = join(root, 'prefix'); await mkdir(prefix);
  await run(process.execPath, [npmCli, 'install', '--global', '--prefix', prefix, '--cache', join(root, 'cache'), '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=optional', '--registry', 'https://registry.invalid/', resolve(archive)], { cwd: root, env, windowsHide: true, timeout: 60000, maxBuffer: 2_000_000 });
  const installed = process.platform === 'win32' ? join(prefix, 'node_modules/ccpt') : join(prefix, 'lib/node_modules/ccpt');
  const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  const cli = join(installed, manifest.bin['ccpt']);
  const check = async args => (await run(process.execPath, [cli, ...args], { cwd: root, env, windowsHide: true, timeout: 15000, maxBuffer: 2_000_000 })).stdout;
  if ((await check(['--version'])).trim() !== manifest.version) throw new Error('Installed CLI/package version mismatch');
  if (!(await check(['model', '--help'])).includes('model acceptance --confirm')) throw new Error('Installed model acceptance entry missing');
  if (!(await check(['plugin', '--help'])).includes('repair-source')) throw new Error('Installed plugin repair entry missing');
  await access(join(installed, 'node_modules/ws/LICENSE'));
  // Execute the actual npm-generated command shim, not only node dist/cli.js.
  const shim = process.platform === 'win32' ? join(prefix, 'ccpt.cmd') : join(prefix, 'bin/ccpt');
  const launched = process.platform === 'win32'
    ? await run(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/cmd.exe'), ['/d', '/c', 'ccpt.cmd', '--version'], { cwd: prefix, env, windowsHide: true, timeout: 15000 })
    : await run(shim, ['--version'], { cwd: root, env, timeout: 15000 });
  if (launched.stdout.trim() !== manifest.version) throw new Error('Installed npm command shim failed');
  const smoke = await run(process.execPath, [join(project, 'scripts/smoke-responses-051.mjs'), dirname(dirname(installed))], { cwd: root, env, windowsHide: true, timeout: 60000, maxBuffer: 2_000_000 });
  const modelSmoke = JSON.parse(smoke.stdout.trim());
  if (!modelSmoke.ok || !modelSmoke.realFileRead || !modelSmoke.backgroundWorker || !modelSmoke.explicitBridge) throw new Error('Installed Agent/worker loopback smoke failed');
  const report = { pass: true, version: manifest.version, archive: resolve(archive), sha256: createHash('sha256').update(await readFile(resolve(archive))).digest('hex'), checks: ['offline npm global install into disposable prefix', 'empty npm cache and isolated config/state', 'actual npm command shim launches', 'Node CLI version and new help entries', 'bundled ws dependency and license', 'installed SDK streaming and actual local file tool roundtrip', 'installed background worker and explicit Chat adapter'], realGlobalInstallChanged: false, modelRequests: modelSmoke.requests, loopbackOnly: true, companyRequests: 0, registryRequests: 0, redistributionApproved: false };
  const evidence = process.env.CCPT_VERIFICATION_OUTPUT ? resolve(process.env.CCPT_VERIFICATION_OUTPUT) : join(project, '.ccpt/delivery-052'); await mkdir(evidence, { recursive: true }); await writeFile(join(evidence, 'installed-package.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid package fixture cleanup path');
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
