export function ndjsonSafeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'bigint') return item.toString();
    if (item instanceof Error) return { name: item.name, message: item.message, stack: item.stack };
    if (Buffer.isBuffer(item)) return { type: 'buffer', base64: item.toString('base64') };
    if (item && typeof item === 'object') { if (seen.has(item)) return '[Circular]'; seen.add(item); }
    return item;
  }).replace(/[\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16)}`);
}
