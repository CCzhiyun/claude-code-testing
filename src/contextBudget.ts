import type { ModelMessage, PlatformConfig, ToolDefinition } from './types.js';
import {countModelText} from './textTokenizer.js';

export interface ContextSnapshot {
  capturedAt: string;
  model: string;
  window: number;
  outputReserve: number;
  safetyReserve: number;
  estimatedInput: number;
  sections: { name: string; tokens: number }[];
  messages: number;
  tools: number;
  textEncoding?: 'cl100k_base' | 'o200k_base' | 'custom';
  vocabularySha256?: string;
  framingTokens?: number;
  inputSource?: 'provider'|'estimate-fallback';
  requestHash?: string;
}

export interface ContextPressureNotice {
  percent: number;
  action: 'warning' | 'compacted' | 'disabled' | 'cannot-compact';
  before: number;
  after: number;
  summaryMethod?: 'extractive' | 'semantic';
  summaryFallback?: string;
  inputSource?:'provider'|'estimate-fallback';
}

/** Occupancy includes output/safety reserves; cumulative billing is never context usage. */
export function contextPressure(snapshot: ContextSnapshot): { percent: number; warn: boolean; compact: boolean } {
  const percent = (snapshot.estimatedInput + snapshot.outputReserve + snapshot.safetyReserve) / snapshot.window * 100;
  return { percent, warn: percent >= 90, compact: percent > 95 };
}

export function formatContextPressure(notice: ContextPressureNotice): string {
  const prefix = `Context ~${notice.percent.toFixed(1)}% (${notice.inputSource==='provider'?'provider-counted':'estimated'} input + output/safety reserves).`;
  if (notice.action === 'compacted') return `${prefix} Above 95%: auto-compacted ~${notice.before} → ~${notice.after} input tokens. Original history archived; current turn preserved.${notice.summaryMethod ? ` Summary: ${notice.summaryMethod}${notice.summaryFallback ? ` (fallback: ${notice.summaryFallback})` : ''}.` : ''}`;
  if (notice.action === 'disabled') return `${prefix} Above 95%, but auto-compact is disabled. Use /compact or enable auto-compact in /settings.`;
  if (notice.action === 'cannot-compact') return `${prefix} Above 95%, but no older complete turn can be removed. Reduce the current input/tool output or unused context; the current turn was not truncated.`;
  return `${prefix} Approaching the context limit. Auto-compact runs above 95% when enabled; /context shows the breakdown.`;
}

export function contextLimits(model: PlatformConfig['model']): { inputBudget: number; outputReserve: number; safetyReserve: number } {
  const outputReserve = model.maxOutputTokens;
  const safetyReserve = Math.min(8192, Math.max(128, Math.ceil(model.maxContextTokens * 0.05)));
  return { inputBudget: Math.max(0, model.maxContextTokens - outputReserve - safetyReserve), outputReserve, safetyReserve };
}

export function conversationBudget(model: PlatformConfig['model'], system: string, tools: ToolDefinition[]): number {
  return Math.max(0, contextLimits(model).inputBudget - estimateContextInput(system,[],tools,model));
}

export function contextFramingTokens(model:PlatformConfig['model']|undefined,messages:number,tools:number):number{
 const f=model?.contextFraming;if(!f)return 0;
 if(Object.keys(f).some(key=>!['baseTokens','perMessageTokens','perToolTokens'].includes(key))||[f.baseTokens,f.perMessageTokens,f.perToolTokens].some(value=>!Number.isSafeInteger(value)||value<0||value>1000000))throw new Error('Invalid model.contextFraming');
 const total=f.baseTokens+f.perMessageTokens*messages+f.perToolTokens*tools;if(!Number.isSafeInteger(total))throw new Error('Context framing overflow');return total;
}

export function contextMessages(messages: ModelMessage[]): unknown[] {
  return messages.map(({ role, content, responses }) => ({ role, content,
    // Text/functions already exist in content. Count opaque reasoning once, not the
    // duplicate raw response, IDs, hashes and other local persistence metadata.
    ...(responses?.output.some((item) => item.type === 'reasoning') ? { reasoning: responses.output.filter((item) => item.type === 'reasoning') } : {}),
  }));
}

export function estimateContextInput(system: string, messages: ModelMessage[], tools: ToolDefinition[],model?:PlatformConfig['model']): number {
  return countModelText(model,{ system, messages: contextMessages(messages), tools })+contextFramingTokens(model,messages.length,tools.length);
}

/** Counts only; never persist system prompts, credentials or repository text in this snapshot. */
export function measureContext(model: PlatformConfig['model'], system: string, messages: ModelMessage[], tools: ToolDefinition[], parts: { skills?: string; memory?: string; repository?: string } = {}): ContextSnapshot {
  const sections = [
    { name: 'Skills', tokens: countModelText(model,parts.skills ?? '') },
    { name: 'Memory', tokens: countModelText(model,parts.memory ?? '') },
    { name: 'Repository', tokens: countModelText(model,parts.repository ?? '') },
  ];
  const systemTokens = countModelText(model,system);
  sections.unshift({ name: 'System / instructions', tokens: Math.max(0, systemTokens - sections.reduce((sum, item) => sum + item.tokens, 0)) });
  sections.push({ name: 'Tool definitions', tokens: countModelText(model,tools) }, { name: 'Conversation / tool results', tokens: countModelText(model,contextMessages(messages)) });
  const estimatedInput = estimateContextInput(system, messages, tools,model);
  sections.push({ name: 'Serialization / framing', tokens: Math.max(0, estimatedInput - sections.reduce((sum, item) => sum + item.tokens, 0)) });
  const { outputReserve, safetyReserve } = contextLimits(model);
  return { capturedAt: new Date().toISOString(), model: model.name, window: model.maxContextTokens, outputReserve, safetyReserve, estimatedInput, sections, messages: messages.length, tools: tools.length, ...(model.tokenizerVocabulary?{textEncoding:model.tokenizerVocabulary.patternEncoding,vocabularySha256:model.tokenizerVocabulary.sha256}:model.tokenizer?{textEncoding:model.tokenizer}:{}), ...(model.contextFraming?{framingTokens:contextFramingTokens(model,messages.length,tools.length)}:{}) };
}

export function formatContextSnapshot(snapshot: ContextSnapshot): string {
  const reserved = snapshot.outputReserve + snapshot.safetyReserve;
  const free = Math.max(0, snapshot.window - snapshot.estimatedInput - reserved);
  const occupied = Math.min(32, Math.ceil((snapshot.estimatedInput + reserved) / snapshot.window * 32));
  return [
    `Last prepared request context (${snapshot.inputSource==='provider'?'provider-counted input':'estimated'}) · ${snapshot.model}`,
    ...(snapshot.inputSource?[`Input provenance: ${snapshot.inputSource}; sections remain approximate; request ${snapshot.requestHash??'unknown'}.`]:[]),
    ...(snapshot.textEncoding ? [`Text BPE breakdown: ${snapshot.textEncoding}; ${snapshot.inputSource==='provider'?'full prepared input is provider-counted; billing is separate':'provider framing/images/billing remain estimated'}.`] : []),
    ...(snapshot.vocabularySha256 ? [`Private vocabulary SHA-256: ${snapshot.vocabularySha256}`] : []),
    ...(snapshot.framingTokens !== undefined ? [`Configured additional framing reserve: ${snapshot.framingTokens} tokens (not billing).`] : []),
    `Captured: ${snapshot.capturedAt}`,
    `[${'#'.repeat(occupied)}${'.'.repeat(32 - occupied)}] ${contextPressure(snapshot).percent.toFixed(1)}% input + reserves · warn ≥90% / compact >95%`,
    ...snapshot.sections.map((item) => `${item.name}: ~${item.tokens} tokens`),
    `${snapshot.inputSource==='provider'?'Provider-counted input total: ':'Estimated input total: ~'}${snapshot.estimatedInput}`,
    `Input alone: ${(snapshot.estimatedInput/snapshot.window*100).toFixed(1)}% of window; reserves are capacity, not consumed tokens.`,
    `Output reserve: ${snapshot.outputReserve} · Safety reserve: ${snapshot.safetyReserve}`,
    `Estimated headroom: ~${free} / ${snapshot.window} tokens`,
    `${snapshot.messages} messages · ${snapshot.tools} tool definitions`,
    snapshot.inputSource==='provider'?'Provider-reported prepared input, not billing; section breakdown is approximate. Snapshot may precede a failed request, not the current edited conversation.':'Approximate breakdown, not provider tokenization or billing. Snapshot is from the last prepared request (which may have failed), not the current edited conversation.',
  ].join('\n');
}
