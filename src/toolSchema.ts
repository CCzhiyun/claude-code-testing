import type { ToolDefinition } from './types.js';

/** Portable structural checks, not a full JSON Schema validator or silent rewriter. */
export function validateToolSchemas(tools: ToolDefinition[]): void {
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
    names.add(tool.name);
    const visit = (value: unknown, path: string, depth = 0): void => {
      if (depth > 64) throw new Error(`Tool schema too deeply nested: ${path}`);
      if (typeof value === 'boolean') return;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid tool schema at ${path}`);
      const schema = value as Record<string, unknown>;
      if ((schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'))) && schema.items === undefined) throw new Error(`Tool schema ${path}: array requires items. Fix the tool definition before sending it to the model.`);
      for (const key of ['properties', '$defs', 'definitions', 'patternProperties']) {
        const map = schema[key];
        if (map && typeof map === 'object') for (const [name, child] of Object.entries(map)) visit(child, `${path}.${key}.${name}`, depth + 1);
      }
      for (const key of ['items', 'additionalProperties', 'not', 'contains', 'if', 'then', 'else']) {
        if (schema[key] !== undefined) {
          const child = schema[key];
          if (Array.isArray(child)) child.forEach((item, i) => visit(item, `${path}.${key}[${i}]`, depth + 1));
          else visit(child, `${path}.${key}`, depth + 1);
        }
      }
      for (const key of ['anyOf', 'oneOf', 'allOf', 'prefixItems']) if (Array.isArray(schema[key])) schema[key].forEach((child, i) => visit(child, `${path}.${key}[${i}]`, depth + 1));
    };
    visit(tool.input_schema, tool.name);
  }
}
