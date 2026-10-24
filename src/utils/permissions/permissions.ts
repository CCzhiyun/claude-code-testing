import type { PlatformConfig } from '../../types.js';
import type { PermissionBehavior, PermissionRule } from './PermissionRule.js';
import type { PermissionResult } from './PermissionResult.js';
import { loadPermissionRules } from './permissionsLoader.js';
import { matchesRuleContent, ruleSpecificity } from './shellRuleMatching.js';

const priority: Record<PermissionBehavior, number> = { allow: 1, ask: 2, deny: 3 };
export function permissionSubject(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'run_command' || toolName === 'shell_start' || toolName === 'bash' || toolName === 'powershell') return [input.command, ...(Array.isArray(input.args) ? input.args : [])].map(String).join(' ').trim();
  if (toolName === 'write_file' || toolName === 'read_file'||toolName==='edit_file') return String(input.path ?? '');
  if(toolName==='notebook_read'||toolName==='notebook_edit')return String(input.notebook_path??'');
  if (toolName.startsWith('mcp_')) return [input.server, input.tool ?? input.uri ?? input.prompt].filter(Boolean).join(':');
  if (toolName === 'remote_trigger') return String(input.url ?? '');
  if (toolName === 'web_fetch') return String(input.url ?? '');
  if (toolName === 'web_search') return String(input.query ?? '');
  if (toolName === 'agent') return String(input.agent_type ?? 'agent');
  if (toolName.startsWith('task_')) return String(input.task_id ?? input.title ?? '');
  return JSON.stringify(input);
}
export function evaluatePermission(toolName: string, input: Record<string, unknown>, config: PlatformConfig): PermissionResult | undefined {
  const subject = permissionSubject(toolName, input);
  const matches = loadPermissionRules(config.policy).filter((rule) => rule.toolName.toLowerCase() === toolName.toLowerCase() && matchesRuleContent(rule.ruleContent, subject));
  matches.sort((left, right) => priority[right.behavior] - priority[left.behavior] || ruleSpecificity(right.ruleContent) - ruleSpecificity(left.ruleContent) || right.index - left.index);
  const rule: PermissionRule | undefined = matches[0];
  if (!rule) return undefined;
  return { behavior: rule.behavior, rule, subject, reason: `${rule.behavior} rule ${rule.toolName}${rule.ruleContent ? `(${rule.ruleContent})` : ''} matched ${subject || '(empty input)'}` };
}
