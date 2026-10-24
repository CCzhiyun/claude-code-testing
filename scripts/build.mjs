import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash, X509Certificate } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--ca-file')) throw new Error('Usage: npm run build [-- --ca-file <public-ca.pem>]');
let pem;
let metadata;
if (args[1]) {
  const content = readFileSync(resolve(args[1]), 'utf8');
  const certificates = content.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ?? [];
  const remainder = content.replace(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g, '').trim();
  if (!certificates.length || remainder || /PRIVATE KEY/.test(content)) throw new Error('Embed public CA certificates only: no private keys, credentials, or extra content');
  const parsed = certificates.map((certificate) => new X509Certificate(certificate));
  for (const certificate of parsed) {
    if (!certificate.ca) throw new Error('Embedded certificate is not a CA certificate');
    if (Date.parse(certificate.validFrom) > Date.now() || Date.parse(certificate.validTo) < Date.now()) throw new Error('Embedded CA certificate is not currently valid');
  }
  pem = `${certificates.join('\n')}\n`;
  metadata = { schemaVersion: 1, sha256: createHash('sha256').update(pem).digest('hex'), certificates: parsed.map((certificate) => ({ fingerprint256: certificate.fingerprint256, validTo: certificate.validTo })) };
}
const result = spawnSync('bun', ['build', './src/cli.ts', './src/entrypoints/sdk.ts', './src/entrypoints/mcp.ts', '--target=node', '--outdir', './dist'], { cwd: root, shell: false, stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const declarations = spawnSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.declarations.json'], { cwd: root, shell: false, stdio: 'inherit', windowsHide: true });
if (declarations.error) throw declarations.error;
if (declarations.status !== 0) process.exit(declarations.status ?? 1);
console.log('Emitted SDK declaration graph for Node TypeScript consumers.');
const certDirectory = join(root, 'dist', 'certs');
const target = join(certDirectory, 'company-ca.pem');
const manifest = join(certDirectory, 'company-ca.json');
if (pem && metadata) {
  mkdirSync(certDirectory, { recursive: true });
  writeFileSync(target, pem);
  writeFileSync(manifest, JSON.stringify(metadata, null, 2) + '\n');
  console.log(`Embedded ${metadata.certificates.length} public CA certificate(s); SHA-256 ${metadata.sha256}. Distribute this package only through an approved company channel.`);
} else {
  // These two generated assets only; never the user's original CA file.
  rmSync(target, { force: true }); rmSync(manifest, { force: true });
  console.log('Built without an embedded company CA; external settings/environment CA remains supported.');
}
