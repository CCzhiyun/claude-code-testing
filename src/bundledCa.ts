import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export function bundledCaFile(): string | undefined {
  if (process.env.CCPT_DISABLE_BUNDLED_CA === '1') return undefined;
  for (const path of ['./certs/company-ca.pem', '../certs/company-ca.pem']) {
    const url = new URL(path, import.meta.url);
    if (!existsSync(url)) continue;
    const manifest = JSON.parse(readFileSync(new URL(path.replace(/\.pem$/, '.json'), import.meta.url), 'utf8')) as { schemaVersion?: number; sha256?: string };
    if (manifest.schemaVersion !== 1 || manifest.sha256 !== createHash('sha256').update(readFileSync(url)).digest('hex')) throw new Error('Bundled CA integrity verification failed; reinstall a trusted package or configure an explicit CA file');
    return fileURLToPath(url);
  }
  return undefined;
}
