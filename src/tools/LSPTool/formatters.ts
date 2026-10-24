import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';

function displayUri(uri: string, cwd: string): string {
  try {
    const path = uri.startsWith('file:') ? fileURLToPath(uri) : uri;
    const local = relative(cwd, path).replaceAll('\\', '/');
    return local.startsWith('../') ? path.replaceAll('\\', '/') : local;
  } catch { return uri; }
}

function locationLine(value: unknown, cwd: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as { uri?: string; targetUri?: string; range?: { start?: { line?: number; character?: number } }; targetSelectionRange?: { start?: { line?: number; character?: number } } };
  const uri = item.uri ?? item.targetUri;
  const start = item.range?.start ?? item.targetSelectionRange?.start;
  if (!uri || start?.line === undefined) return undefined;
  return `${displayUri(uri, cwd)}:${start.line + 1}:${(start.character ?? 0) + 1}`;
}

export function formatLspResult(result: unknown, cwd: string): string {
  if (result === null || result === undefined || (Array.isArray(result) && result.length === 0)) return 'No LSP result found.';
  const values = Array.isArray(result) ? result : [result];
  const locations = values.map((item) => locationLine(item, cwd)).filter((item): item is string => Boolean(item));
  if (locations.length) return locations.join('\n');
  return JSON.stringify(result, null, 2);
}
