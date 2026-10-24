import type { PlatformConfig } from '../../types.js';
import type { PermissionBehavior, PermissionRule } from './PermissionRule.js';
import { permissionRuleValueFromString } from './permissionRuleParser.js';

export function loadPermissionRules(policy: PlatformConfig['policy']): PermissionRule[] {
  const output: PermissionRule[] = [];
  for (const behavior of ['allow', 'ask', 'deny'] as PermissionBehavior[]) {
    const values = policy.permissionRules[behavior];
    values.forEach((value, index) => {
      const parsed=permissionRuleValueFromString(value);
      output.push({...parsed,behavior,source:'policy.permissionRules',index});
      // Compatibility must never silently discard a denial or widen an allow.
      // Native allow rules remain explicit; ask/deny aliases cover all variants.
      const aliases:Record<string,string[]>={read:['read_file','notebook_read'],write:['write_file','notebook_edit','apply_patch'],edit:['edit_file','notebook_edit','apply_patch'],bash:['run_command','shell_start'],grep:['search_text'],glob:['list_files']};
      if(behavior!=='allow')for(const toolName of aliases[parsed.toolName.toLowerCase()]??[]){const{ruleContent,...base}=parsed;output.push({...(toolName==='apply_patch'?base:parsed),toolName,behavior,source:'policy.permissionRules',index});}
    });
  }
  return output;
}
