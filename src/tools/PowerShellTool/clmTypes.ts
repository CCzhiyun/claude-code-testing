export const CLM_ALLOWED_TYPES: ReadonlySet<string> = new Set(['system.string', 'system.int32', 'system.int64', 'system.boolean', 'system.datetime', 'system.guid', 'system.uri', 'system.version', 'system.math', 'system.convert', 'system.text.encoding']);
export function normalizeTypeName(name: string): string { return name.trim().replace(/^\[|\]$/g, '').toLowerCase(); }
export function isClmAllowedType(typeName: string): boolean { return CLM_ALLOWED_TYPES.has(normalizeTypeName(typeName)); }
