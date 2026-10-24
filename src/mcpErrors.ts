import { redactModelDiagnostic } from './modelErrors.js';
import { validateMcpUrlElicitation,type McpInteractionHandlers,type McpUrlElicitation } from './mcpInteraction.js';

/** Structured error, never automatically invokes an external URL or replays tools. */
export class McpProtocolError extends Error {
  readonly code:number;
  readonly elicitations?:McpUrlElicitation[];
  readonly urlElicitationBlocked?:boolean;
  constructor(value:unknown,handlers?:McpInteractionHandlers){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid MCP error envelope');
    const row=value as Record<string,unknown>;
    if(!Number.isSafeInteger(row.code)||typeof row.message!=='string')throw new Error('Invalid MCP error envelope');
    super(`MCP RPC error ${row.code}: ${redactModelDiagnostic(row.message)}`);this.name='McpProtocolError';this.code=Number(row.code);
    if(this.code===-32042){
      // Raw data/URLs are excluded from message/stack/diagnostics. Expose only
      // validated, pinned-origin values to the explicit requesting SDK caller.
      const data=row.data as {elicitations?:unknown}|undefined;
      if(!data||!Array.isArray(data.elicitations)||data.elicitations.length<1||data.elicitations.length>8)throw new Error('Invalid URL elicitation required error');
      try{const ids=new Set<string>(),requests=data.elicitations.map(item=>{const request=validateMcpUrlElicitation(item,handlers?.urlOrigins);if(ids.has(request.elicitationId))throw new Error('Duplicate required elicitation ID');ids.add(request.elicitationId);return request;});
        Object.defineProperty(this,'elicitations',{value:requests,enumerable:false,writable:false});
      }catch{Object.defineProperty(this,'urlElicitationBlocked',{value:true,enumerable:true,writable:false});}
    }
  }
}
