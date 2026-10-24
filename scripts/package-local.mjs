// Local-owner validation bundle only. Does not publish or grant redistribution rights.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, cp, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const run = promisify(execFile), root = dirname(dirname(fileURLToPath(import.meta.url)));
if (process.argv.slice(2).join(' ') !== '--local-preview') throw new Error('Only --local-preview is supported; reviewed registry releases use release:check');
const npmCli = process.env.npm_execpath;
if (!npmCli || !/[\\/]npm-cli\.js$/i.test(npmCli)) throw new Error('Use npm run pack:delivery');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Unexpected local package version');
await access(join(root, 'dist/cli.js')); await access(join(root, 'dist/types/src/entrypoints/sdk.d.ts'));
const releases = join(root, 'releases');
try { const info = await lstat(releases); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Releases must be a real directory, not a link'); }
catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(releases); }
const directory = await mkdtemp(join(releases, `local-${manifest.version}-`));
const packed = await run(process.execPath, [npmCli, 'pack', '--json', '--pack-destination', directory], { cwd: root, windowsHide: true, timeout: 60000, maxBuffer: 4_000_000 });
const info = JSON.parse(packed.stdout)[0];
if (info.filename !== `ccpt-${manifest.version}.tgz`) throw new Error('Unexpected packed filename');
const forbidden = info.files.filter(file => /(^|\/)(?:\.ccpt|\.env(?:\.|$)|settings\.json|model-credentials[^/]*|mcp-tokens[^/]*)($|\/)|\.(?:pem|key|pfx|p12)$/i.test(file.path));
if (forbidden.length) throw new Error('Local package contains forbidden private state or certificate/key assets; review locally');
if (!info.bundled.includes('ws')) throw new Error('Runtime ws dependency must be bundled for offline installation');
for(const dependency of ['js-tiktoken','base64-js'])if(!info.bundled.includes(dependency))throw new Error(`Text tokenizer runtime dependency ${dependency} must be bundled for offline installation`);
const hash = createHash('sha256').update(await readFile(join(directory, info.filename))).digest('hex');
await writeFile(join(directory, 'SHA256SUMS.txt'), `${hash}  ${info.filename}\n`);
const guide = `docs/DELIVERY-${manifest.version.split('.').slice(0, 2).join('.')}.zh-CN.md`;
await cp(join(root, guide), join(directory, 'INSTALL.zh-CN.md'));
await mkdir(join(directory, 'config-templates'));
for (const name of ['settings-responses.example.json', 'settings-chat-completions.example.json', 'settings-messages.example.json']) await cp(join(root, 'docs', name), join(directory, 'config-templates', name));
const report = { version: manifest.version, archive: info.filename, bytes: info.size, sha256: hash, localOwnerValidationOnly: true, redistributionApproved: false, published: false, personalConfigurationIncluded: false, companyCAIncluded: false, notice: 'Do not redistribute until source rights, third-party notices and enterprise approval have been reviewed. This file and hash are not legal authorization or a publisher signature.' };
await writeFile(join(directory, 'DELIVERY.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ directory, ...report }, null, 2));
