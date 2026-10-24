// Technical provenance/change gate. A human review record is NOT a license grant.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function distributionInventory(root) {
  const readMetadata = async name => { const path = join(root, name), info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || info.size > 16_000_000) throw new Error('Invalid distribution metadata path/size'); return JSON.parse(await readFile(path, 'utf8')); };
  const manifest = await readMetadata('package.json');
  const lock = await readMetadata('package-lock.json');
  const files = [], embeddedCertificates = [], privateMaterial = [];
  const visit = async relative => {
    const path = join(root, relative);
    let info; try { info = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw new Error('Distribution inventory refuses symlinks/junctions');
    if (info.isDirectory()) { for (const name of (await readdir(path)).sort()) await visit(relative + '/' + name); return; }
    if (!info.isFile() || info.size > 32_000_000 || files.length >= 10000) throw new Error('Distribution inventory file/type/size limit exceeded');
    const content = await readFile(path);
    files.push({ path: relative, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
    if (/\.(?:pem|pfx|p12|key)$/i.test(relative)) embeddedCertificates.push(relative);
    if (/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----\r?\n/.test(content.toString('utf8'))) privateMaterial.push(relative);
  };
  for (const path of ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'NOTICE', 'src', 'scripts', 'dist', 'docs', 'vscode-extension']) await visit(path);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const dependencies = Object.entries(lock.packages ?? {}).filter(([path]) => path.startsWith('node_modules/')).map(([path, value]) => ({ path, version: value.version ?? null, licenseClaim: value.license ?? 'UNREVIEWED', dev: value.dev === true, integrity: value.integrity ?? null })).sort((a, b) => a.path.localeCompare(b.path));
  const content = { schemaVersion: 1, package: { name: manifest.name, version: manifest.version, licenseClaim: manifest.license ?? 'UNREVIEWED' }, files, dependencies, embeddedCertificates, privateMaterial };
  return { ...content, digest: createHash('sha256').update(JSON.stringify(content)).digest('hex'), sourceRights: 'HUMAN_REVIEW_REQUIRED', noticePresent: files.some(file => file.path === 'NOTICE'), isLegalAuthorization: false };
}
function evaluateDistributionReview(inventory, review, registry) {
  const blockers = [];
  if (inventory.privateMaterial.length) blockers.push('Private-key material is present; never distribute it');
  if (!inventory.files.some(file => file.path === 'dist/cli.js') || !inventory.files.some(file => file.path === 'dist/types/src/entrypoints/sdk.d.ts')) blockers.push('Build runtime and SDK declaration artifacts first');
  if (!review || review.schemaVersion !== 1 || review.approved !== true) blockers.push('Explicit human redistribution approval is missing');
  if (review?.inventoryDigest !== inventory.digest) blockers.push('Review digest does not match the current source/build/dependency inventory');
  if (typeof review?.reviewedBy !== 'string' || !review.reviewedBy.trim() || !Number.isFinite(Date.parse(review?.reviewedAt)) || Date.parse(review.reviewedAt) > Date.now()) blockers.push('Reviewer identity/date is missing or invalid');
  if (!Array.isArray(review?.sourceRightsEvidence) || !review.sourceRightsEvidence.length || review.sourceRightsEvidence.some(value => typeof value !== 'string' || !value.trim())) blockers.push('Source ownership/third-party redistribution evidence must be reviewed');
  if (review?.dependenciesReviewed !== true || review?.noticeReviewed !== true || !inventory.noticePresent) blockers.push('Dependencies and a real NOTICE must be reviewed');
  if (!['internal', 'public'].includes(review?.distributionScope)) blockers.push('Choose the reviewed distribution scope');
  if (inventory.embeddedCertificates.length && review?.embeddedCertificatesReviewed !== true) blockers.push('Embedded certificate distribution/rotation requires explicit review');
  const normalizeRegistry = value => { try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return ''; return url.href.replace(/\/$/, ''); } catch { return ''; } };
  if (!normalizeRegistry(registry) || normalizeRegistry(review?.approvedRegistry) !== normalizeRegistry(registry)) blockers.push('Publishing registry is not the reviewed HTTPS destination');
  if (review?.distributionScope === 'internal' && normalizeRegistry(registry) === 'https://registry.npmjs.org') blockers.push('Internal-only approval cannot publish to the public npm registry');
  return { approved: blockers.length === 0, blockers, inventoryDigest: inventory.digest, isLegalAuthorization: false };
}
async function main() {
  const args = process.argv.slice(2), option = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
  const root = resolve(option('--root', dirname(dirname(fileURLToPath(import.meta.url)))));
  const inventory = await distributionInventory(root);
  if (!args.includes('--check')) { console.log(JSON.stringify(inventory, null, 2)); return; }
  let review = null;
  try { const text = await readFile(resolve(root, option('--approval', 'distribution-review.json')), 'utf8'); if (Buffer.byteLength(text) > 64000) throw new Error('Review file exceeds limit'); review = JSON.parse(text); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = evaluateDistributionReview(inventory, review, option('--registry', process.env.npm_config_registry ?? 'https://registry.npmjs.org/'));
  console.log(JSON.stringify({ ...result, notice: 'This local change/approval gate does not grant rights, authenticate a reviewer or replace legal/supply-chain review.' }, null, 2));
  if (!result.approved) process.exitCode = 2;
}
main().catch(() => { console.error('Distribution audit failed; inspect local paths/metadata without exporting credentials.'); process.exitCode = 1; });
