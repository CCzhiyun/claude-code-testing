import { ndjsonSafeStringify } from './ndjsonSafeStringify.js';
export function printValue(value: unknown, options: { json?: boolean; stream?: NodeJS.WritableStream } = {}): void { const stream = options.stream ?? process.stdout; stream.write(options.json || typeof value !== 'string' ? `${ndjsonSafeStringify(value)}\n` : `${value}\n`); }
