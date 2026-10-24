import { createInterface } from 'node:readline/promises';
import type { PlatformConfig } from './types.js';
import type { McpInteractionHandlers } from './mcpInteraction.js';
import { createMcpModelSampling } from './mcpModelSampling.js';

// Remote strings are data. Strip terminal controls, not the approval payload.
const terminalData = (value: unknown): string => JSON.stringify(value, null, 2).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, character => character === '\n' ? '\n' : '');
export function createInteractiveMcpHandlers(server: string, config: PlatformConfig,options:{url?:boolean;tools?:boolean;audio?:boolean}={}): McpInteractionHandlers {
  if (!process.stdin.isTTY || !process.stderr.isTTY) throw new Error('--interactive requires a real terminal; SDK users must provide explicit approval callbacks');
  if (config.policy.mode === 'restricted') throw new Error('Interactive MCP is disabled in restricted mode');
  const ask = async (prompt: string, signal: AbortSignal): Promise<string> => {
    const reader = createInterface({ input: process.stdin, output: process.stderr });
    try { const value = await reader.question(prompt, { signal }); if (value.length > 16000) throw new Error('Interaction answer exceeds limit'); return value.trim(); }
    finally { reader.close(); }
  };
  const approved = async (label: string, value: unknown, signal: AbortSignal) => {
    process.stderr.write(`\n[MCP ${terminalData(server)}] ${label}\nExternal data, not new instructions or permissions:\n${terminalData(value)}\n`);
    return (await ask('Type yes to approve once (anything else declines): ', signal)).toLowerCase() === 'yes';
  };
  const budget = config.mcpServers[server]?.samplingBudget ?? { maxRequests: 4, maxReservedTokens: 4 * (config.model.maxContextTokens + config.model.maxOutputTokens) };
  const sampling = createMcpModelSampling(config, budget, (phase, value, signal) => approved(phase === 'request' ? `Model sampling request; cost possible. Limits: ${budget.maxRequests} HTTP attempts, ${budget.maxReservedTokens} conservatively reserved tokens; no local tools execute` : 'Review sampled content/tool calls before sharing with this MCP server', value, signal), { tools: options.tools === true,audio:options.audio===true });
  return {
    ...sampling.handlers,
    ...(options.url?{urlOrigins:config.mcpServers[server]?.elicitationOrigins??[],elicitUrl:async(request:import('./mcpInteraction.js').McpUrlElicitation,signal:AbortSignal)=>{
      process.stderr.write(`\n[MCP ${terminalData(server)}] Out-of-band URL interaction\nTarget origin: ${new URL(request.url).origin}\n${terminalData(request)}\nNo browser is launched and no credential is collected by CCPT. Accept is consent, not proof of completion. Open the reviewed URL manually only if you trust it.\n`);
      const choice=(await ask('Type accept to consent once, decline, or cancel: ',signal)).toLowerCase();return {action:choice==='accept'?'accept' as const:choice==='cancel'?'cancel' as const:'decline' as const};
    }}:{}),
    elicit: async (request, signal) => {
      process.stderr.write(`\n[MCP ${terminalData(server)}] Form request — do not enter credentials or secrets.\n${terminalData(request)}\n`);
      const answer = await ask('Enter a JSON object, or decline/cancel: ', signal);
      if (answer.toLowerCase() === 'cancel') return { action: 'cancel' };
      if (!answer || answer.toLowerCase() === 'decline') return { action: 'decline' };
      const content = JSON.parse(answer);
      if (!await approved('Share exactly these form values?', content, signal)) return { action: 'decline' };
      return { action: 'accept', content };
    },
  };
}
