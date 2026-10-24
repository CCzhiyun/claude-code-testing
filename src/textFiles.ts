import { open } from 'node:fs/promises';

export class NonTextFileError extends Error {
  constructor(public readonly path: string) { super(`Not a UTF-8 text file: ${path}. Use an appropriate binary/image/document tool instead.`); this.name = 'NonTextFileError'; }
}
export class TextFileLimitError extends Error {
  constructor(limit: number) { super(`File exceeds the ${limit} byte text read limit`); this.name = 'TextFileLimitError'; }
}

/** Bounded even when a file grows between stat and read; never lossy-decode binary. */
export async function readUtf8Text(path: string, limit: number): Promise<string> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error(`Read target is not a regular file: ${path}`);
    if (info.size > limit) throw new TextFileLimitError(limit);
    const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1));
    let length = 0;
    while (length < bytes.length) {
      const part = await file.read(bytes, length, bytes.length - length, length);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length > limit) throw new TextFileLimitError(limit);
    if (length > info.size) throw new Error(`File changed while reading: ${path}. Retry after the writer finishes.`);
    const content = bytes.subarray(0, length);
    if (content.includes(0)) throw new NonTextFileError(path);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(content); } catch { throw new NonTextFileError(path); }
    if (/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new NonTextFileError(path);
    return text;
  } finally { await file.close(); }
}

export function positiveLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 1 || !Number.isInteger(value)) throw new Error('limit must be a positive finite integer');
  return Math.min(value, maximum);
}
