const regexSpecial = /[.+?^${}()|[\]\\]/g;
export function permissionRuleExtractPrefix(rule: string): string | null { return rule.match(/^(.+):\*$/)?.[1] ?? null; }
export function hasWildcards(pattern: string): boolean { if (pattern.endsWith(':*')) return false; for (let index = 0; index < pattern.length; index += 1) if (pattern[index] === '*' && (index === 0 || pattern[index - 1] !== '\\')) return true; return false; }
export function matchWildcardPattern(pattern: string, value: string, caseInsensitive = false): boolean {
  const placeholder = '\u0000';
  const escapedLiteral = pattern.trim().replace(/\\\*/g, placeholder).replace(regexSpecial, '\\$&').replace(/\*/g, '.*').replaceAll(placeholder, '\\*');
  const optionalArgs = escapedLiteral.endsWith(' .*') && (escapedLiteral.match(/\.\*/g)?.length ?? 0) === 1 ? `${escapedLiteral.slice(0, -3)}(?: .*)?` : escapedLiteral;
  return new RegExp(`^${optionalArgs}$`, caseInsensitive ? 'is' : 's').test(value);
}
export function matchesRuleContent(pattern: string | undefined, value: string): boolean {
  if (!pattern) return true;
  const prefix = permissionRuleExtractPrefix(pattern);
  if (prefix !== null) return value === prefix || value.startsWith(`${prefix} `);
  return hasWildcards(pattern) ? matchWildcardPattern(pattern, value, true) : pattern.toLowerCase() === value.toLowerCase();
}
export function ruleSpecificity(pattern?: string): number { if (!pattern) return 0; if (permissionRuleExtractPrefix(pattern) !== null) return 1; if (hasWildcards(pattern)) return 2; return 3; }
