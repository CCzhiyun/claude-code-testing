import type { McpServerConfig } from './types.js';

/** Recovery is an administrator-declared server protocol, never guessed from a
 * tool name. Validate before a model/connector can cause an external operation. */
export function validateOperationRecovery(value:unknown):asserts value is NonNullable<McpServerConfig['operationRecovery']>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>100)throw new Error('Invalid MCP operationRecovery map');
  const name=(v:unknown)=>typeof v==='string'&&/^[-\w.:]{1,120}$/.test(v);
  const argument=(v:unknown)=>typeof v==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v)&&!['__proto__','constructor','prototype'].includes(v);
  for(const [tool,raw]of Object.entries(value)){
    if(!name(tool)||!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid MCP operation recovery protocol');
    const spec=raw as Record<string,unknown>;
    if(Object.keys(spec).some(key=>!['idempotencyArgument','statusTool','compensateTool','operationArgument','businessScope','businessKeyFields'].includes(key))||!argument(spec.idempotencyArgument)||!name(spec.statusTool)||spec.compensateTool!==undefined&&!name(spec.compensateTool)||spec.operationArgument!==undefined&&!argument(spec.operationArgument))throw new Error('Invalid MCP operation recovery protocol');
    if(spec.businessScope!==undefined||spec.businessKeyFields!==undefined){const fields=spec.businessKeyFields;if(!name(spec.businessScope)||!Array.isArray(fields)||fields.length<1||fields.length>8||new Set(fields).size!==fields.length||fields.some(field=>!argument(field)||field===spec.idempotencyArgument))throw new Error('Invalid MCP business idempotency scope/fields');}
  }
}
