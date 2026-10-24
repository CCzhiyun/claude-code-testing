import type { PermissionRuleValue } from './PermissionRule.js';

export function escapeRuleContent(content: string): string { return content.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
export function unescapeRuleContent(content: string): string { return content.replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\'); }
function unescaped(value: string, character: string, reverse = false): number {
  const start = reverse ? value.length - 1 : 0; const end = reverse ? -1 : value.length; const step = reverse ? -1 : 1;
  for (let index = start; index !== end; index += step) if (value[index] === character) { let slashes = 0; for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) slashes += 1; if (slashes % 2 === 0) return index; }
  return -1;
}
export function permissionRuleValueFromString(value: string): PermissionRuleValue {
  const open = unescaped(value, '('); const close = unescaped(value, ')', true);
  if (open < 1 || close !== value.length - 1 || close <= open) return { toolName: value };
  const content = value.slice(open + 1, close);
  return content && content !== '*' ? { toolName: value.slice(0, open), ruleContent: unescapeRuleContent(content) } : { toolName: value.slice(0, open) };
}
export function permissionRuleValueToString(value: PermissionRuleValue): string { return value.ruleContent ? `${value.toolName}(${escapeRuleContent(value.ruleContent)})` : value.toolName; }
