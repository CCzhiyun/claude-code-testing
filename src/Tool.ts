import type { ToolDefinition } from './types.js';

export interface ToolSearchMatch {
  name: string;
  description: string;
  score: number;
}

function searchableName(name: string): string[] {
  const normalized = name
    .replace(/^mcp__/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('__', ' ')
    .replaceAll('_', ' ')
    .toLowerCase();
  return normalized.split(/\s+/).filter(Boolean);
}

/**
 * Canonical tool catalog. It centralizes duplicate detection, allow/deny
 * filtering, and the deferred-tool keyword lookup used by the agent runtime.
 */
export class ToolRegistry {
  readonly #tools: ToolDefinition[];
  readonly #byName: Map<string, ToolDefinition>;

  constructor(definitions: ToolDefinition[]) {
    this.#tools = [];
    this.#byName = new Map();
    for (const definition of definitions) {
      const key = definition.name.toLowerCase();
      if (this.#byName.has(key)) throw new Error(`Duplicate tool name: ${definition.name}`);
      this.#tools.push(definition);
      this.#byName.set(key, definition);
    }
  }

  list(): ToolDefinition[] { return [...this.#tools]; }

  get(name: string): ToolDefinition | undefined { return this.#byName.get(name.toLowerCase()); }

  filter(allowed?: ReadonlySet<string>, denied: ReadonlySet<string> = new Set()): ToolDefinition[] {
    return this.#tools.filter((tool) => (!allowed || allowed.has(tool.name)) && !denied.has(tool.name));
  }

  search(query: string, maxResults = 5): ToolSearchMatch[] {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const selection = trimmed.match(/^select:(.+)$/i);
    if (selection?.[1]) {
      return selection[1].split(',').map((name) => name.trim()).filter(Boolean)
        .map((name) => this.get(name)).filter((tool): tool is ToolDefinition => Boolean(tool))
        .slice(0, Math.max(1, maxResults))
        .map((tool) => ({ name: tool.name, description: tool.description, score: 100 }));
    }

    const terms = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    const required = terms.filter((term) => term.startsWith('+') && term.length > 1).map((term) => term.slice(1));
    const optional = terms.filter((term) => !term.startsWith('+'));
    const scoringTerms = required.length ? [...required, ...optional] : optional;
    return this.#tools.map((tool) => {
      const parts = searchableName(tool.name);
      const description = tool.description.toLowerCase();
      if (!required.every((term) => parts.some((part) => part.includes(term)) || description.includes(term))) return undefined;
      let score = 0;
      for (const term of scoringTerms) {
        if (tool.name.toLowerCase() === term) score += 20;
        if (parts.includes(term)) score += 10;
        else if (parts.some((part) => part.includes(term))) score += 5;
        if (description.includes(term)) score += 2;
      }
      return score > 0 ? { name: tool.name, description: tool.description, score } : undefined;
    }).filter((match): match is ToolSearchMatch => Boolean(match))
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, Math.max(1, Math.min(maxResults, 50)));
  }
}

export function buildTool(definition: ToolDefinition): ToolDefinition {
  if (!definition.name.trim()) throw new Error('Tool name is required');
  if (!definition.description.trim()) throw new Error(`Tool ${definition.name} requires a description`);
  return Object.freeze({ ...definition, input_schema: structuredClone(definition.input_schema) });
}
