export interface MarkdownDocument {
  attributes: Record<string, unknown>;
  body: string;
}

function parseScalar(source: string): unknown {
  const value = source.trim();
  if (!value) return '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith('[') && value.endsWith(']')) {
    const parts: string[] = []; let item = '', quote = '', escaped = false;
    for (const character of value.slice(1, -1)) {
      if (escaped) { item += character; escaped = false; continue; }
      if (character === '\\' && quote === '"') { item += character; escaped = true; continue; }
      if (quote) { item += character; if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") { quote = character; item += character; }
      else if (character === ',') { parts.push(item); item = ''; }
      else item += character;
    }
    if (quote) throw new Error('Unterminated quoted frontmatter list item');
    parts.push(item);
    return parts.filter(part => part.trim()).map(part => parseScalar(part));
  }
  const quoted = value.match(/^(['"])(.*)\1$/);
  if (quoted) {
    if (quoted[1] === '"') { try { return JSON.parse(value); } catch { throw new Error('Invalid double-quoted frontmatter value'); } }
    return (quoted[2] ?? '').replaceAll("''", "'");
  }
  if (value.startsWith('"') || value.startsWith("'")) throw new Error('Unterminated quoted frontmatter value');
  return value;
}

export function parseMarkdownDocument(source: string): MarkdownDocument {
  const normalized = source.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  if (!normalized.startsWith('---\n')) return { attributes: {}, body: normalized.trim() };
  const ending = /^---[ \t]*(?:\n|$)/gm; ending.lastIndex = 4;
  const terminator = ending.exec(normalized);
  if (!terminator) throw new Error('Unterminated frontmatter header');
  const end = terminator.index;
  const attributes: Record<string, unknown> = {};
  const lines = normalized.slice(4, end).split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) throw new Error('Unsupported nested frontmatter; use top-level scalar fields or string lists');
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe frontmatter key');
    if (Object.hasOwn(attributes, key)) throw new Error(`Duplicate frontmatter key: ${key}`);
    const value = line.slice(separator + 1).trim();
    if (!value && /^\s+-\s/.test(lines[index + 1] ?? '')) {
      const items: unknown[] = [];
      while (/^\s+-\s/.test(lines[index + 1] ?? '')) items.push(parseScalar(lines[++index]!.trim().slice(2)));
      attributes[key] = items;
    } else if (value === '|' || value === '>') {
      const parts: string[] = [];
      while (/^\s/.test(lines[index + 1] ?? '')) parts.push(lines[++index]!.trim());
      attributes[key] = parts.join(value === '|' ? '\n' : ' ');
    } else attributes[key] = parseScalar(value);
  }
  return { attributes, body: normalized.slice(end + terminator[0].length).trim() };
}

export function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return value.split(',').map((item) => item.trim()).filter(Boolean);
  return undefined;
}
