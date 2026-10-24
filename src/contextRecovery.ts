import type { PlatformConfig, SessionRecord, ToolDefinition } from './types.js';
import type { ModelResponse, ModelStreamHandlers } from './model.js';
import { ContextLimitError } from './modelErrors.js';
import { compactSession } from './sessions.js';
import { conversationBudget, measureContext, contextPressure, contextMessages, type ContextPressureNotice } from './contextBudget.js';
import { countModelText } from './textTokenizer.js';
import { refineCompaction } from './semanticCompaction.js';
import { runHooks } from './hooks.js';
import {countProviderInput,withPreparedInputCount} from './inputTokenCounting.js';
import type {ContextSnapshot} from './contextBudget.js';

export interface ContextRecoveryNotice {
  attempt: number;
  source: 'local' | 'provider';
  before: number;
  after: number;
  window: number;
}

export function prepareContext(config: PlatformConfig, session: SessionRecord, system: string, tools: ToolDefinition[], snapshot?:ContextSnapshot): ContextPressureNotice | undefined {
  const before = snapshot??measureContext(config.model, system, session.messages, tools);
  const pressure = contextPressure(before);
  session.contextSnapshot = before;
  const band = pressure.compact ? 95 : pressure.warn ? 90 : 0;
  const previousBand = session.contextWarningBand;
  session.contextWarningBand = band;
  if (!band) { delete session.contextPressure; return; }
  let action: ContextPressureNotice['action'] = 'warning';
  if (pressure.compact) {
    if (!config.ui.autoCompact) action = 'disabled';
    else {
      compactSession(session, conversationBudget(config.model, system, tools), { force: true, model:config.model });
      session.contextSnapshot = measureContext(config.model, system, session.messages, tools);
      action = session.contextSnapshot.estimatedInput < before.estimatedInput ? 'compacted' : 'cannot-compact';
      if (action === 'compacted') session.contextWarningBand = 0;
    }
  }
  const notice = { percent: pressure.percent, action, before: before.estimatedInput, after: session.contextSnapshot.estimatedInput,...(before.inputSource?{inputSource:before.inputSource}:{}) };
  const previousAction = session.contextPressure?.action;
  session.contextPressure = notice;
  return band !== previousBand || action !== previousAction || action === 'compacted' ? notice : undefined;
}

/** At most two recovery retries per request. Optional semantic refinement is bounded and checkpointed. */
export async function queryWithContextRecovery(options: {
  config: PlatformConfig; session: SessionRecord; system: string; tools: ToolDefinition[];
  query: (stream: ModelStreamHandlers) => Promise<ModelResponse>;
  stream?: ModelStreamHandlers;
  onRecovery: (notice: ContextRecoveryNotice) => Promise<void>;
  onPressure?: (notice: ContextPressureNotice) => Promise<void>;
}): Promise<ModelResponse> {
  const { config, session, system, tools } = options;
  const previousSummary = session.summary;
  const archiveOffset = session.archivedMessages?.length ?? 0;
  let snapshot=measureContext(config.model,system,session.messages,tools);
  let measured:Awaited<ReturnType<typeof countProviderInput>>,countLimit:ContextLimitError|undefined;
  try{measured=options.onPressure?await countProviderInput(config,system,session.messages,tools):undefined;}
  catch(error){if(!(error instanceof ContextLimitError)||!config.ui.autoCompact)throw error;countLimit=error;if(error.windowHint)config.model.maxContextTokens=Math.min(config.model.maxContextTokens,error.windowHint);snapshot=measureContext(config.model,system,session.messages,tools);snapshot.estimatedInput=Math.max(snapshot.estimatedInput,snapshot.window);snapshot.inputSource='estimate-fallback';}
  if(measured){snapshot.inputSource=measured.source;snapshot.requestHash=measured.requestHash;if('inputTokens'in measured&&measured.inputTokens!==undefined)snapshot.estimatedInput=measured.inputTokens;}
  if (options.onPressure && config.ui.autoCompact && contextPressure(snapshot).compact) await runHooks(config, 'PreCompact', { sessionId: session.id, trigger: 'auto', source: 'context-threshold' }, session.cwd);
  const notice = options.onPressure ? prepareContext(config, session, system, tools,snapshot) : undefined;
  if (notice) await options.onPressure?.(notice);
  if(countLimit&&notice?.action!=='compacted')throw new Error(`${countLimit.message}\nInput counting reached the provider limit and no older complete turn could be compacted. Current turn/history preserved; reduce attachments or output reserve, or use /context.`,{cause:countLimit});
  if (notice?.action === 'compacted') await runHooks(config, 'PostCompact', { sessionId: session.id, trigger: 'auto', source: 'context-threshold', archivedMessages: session.archivedMessages?.length ?? 0 }, session.cwd);
  if (notice?.action === 'compacted') await refineCompaction({ config, session, previousSummary, archiveOffset, persist: async () => {
    session.contextSnapshot = measureContext(config.model, system, session.messages, tools);
    notice.after = session.contextSnapshot.estimatedInput;
    if (session.compaction) notice.summaryMethod = session.compaction.method;
    if (session.compaction?.fallback) notice.summaryFallback = session.compaction.fallback;
    else delete notice.summaryFallback;
    await options.onPressure?.(notice);
  } });
  if(notice?.action==='compacted'&&config.model.inputTokenCounting){const count=await countProviderInput(config,system,session.messages,tools);if(count&&session.contextSnapshot){session.contextSnapshot.inputSource=count.source;session.contextSnapshot.requestHash=count.requestHash;if('inputTokens'in count&&count.inputTokens!==undefined){session.contextSnapshot.estimatedInput=count.inputTokens;notice.after=count.inputTokens;}await options.onPressure?.(notice);}}
  for (let attempt = 0; ; attempt++) {
    let emitted = false;
    try {
      if(attempt>0&&options.onPressure&&config.model.inputTokenCounting){const count=await countProviderInput(config,system,session.messages,tools);if(count&&session.contextSnapshot){session.contextSnapshot.inputSource=count.source;session.contextSnapshot.requestHash=count.requestHash;if('inputTokens'in count&&count.inputTokens!==undefined)session.contextSnapshot.estimatedInput=count.inputTokens;}}
      const current=session.contextSnapshot;
      // Only this invocation's count is eligible; persisted/stale snapshots cannot bypass limits.
      const counted=options.onPressure&&current?.inputSource==='provider'&&current.requestHash?{inputTokens:current.estimatedInput,requestHash:current.requestHash,source:'provider' as const}:undefined;
      return await withPreparedInputCount(counted,()=>options.query({
        ...(options.stream?.onRetry ? { onRetry: options.stream.onRetry } : {}),
        onTextDelta(delta) { if (delta) emitted = true; options.stream?.onTextDelta?.(delta); },
        onThinkingDelta(delta) { if (delta) emitted = true; options.stream?.onThinkingDelta?.(delta); },
      }));
    } catch (error) {
      if (!(error instanceof ContextLimitError)) throw error;
      const guidance = 'Context recovery stopped. Use /context, reduce the latest input/tool output or unused skills/MCP tools, lower model.maxOutputTokens, or configure a genuinely supported model.maxContextTokens. Full history remains available through /export; the latest turn was not truncated.';
      if (!config.ui.autoCompact || emitted || attempt >= 2) {
        throw new Error(`${error.message}\n${!config.ui.autoCompact ? 'Auto-compact is disabled.' : emitted ? 'Partial output was already received; it will not be replayed automatically.' : 'Recovery retry limit reached.'}\n${guidance}`, { cause: error });
      }
      const before = countModelText(config.model,contextMessages(session.messages));
      // Runtime-only reduction: do not rewrite shared settings or claim a larger model window.
      if (error.windowHint) config.model.maxContextTokens = Math.min(config.model.maxContextTokens, error.windowHint);
      const budget = conversationBudget(config.model, system, tools);
      const candidate = structuredClone(session);
      const previousSummary = session.summary;
      const archiveOffset = session.archivedMessages?.length ?? 0;
      await runHooks(config, 'PreCompact', { sessionId: session.id, trigger: 'auto', source: 'provider-limit' }, session.cwd);
      compactSession(candidate, budget, { force: true, model:config.model });
      const after = countModelText(config.model,contextMessages(candidate.messages));
      if (budget <= 0 || after >= before) throw new Error(`${error.message}\nNo removable older complete turn fits the budget.\n${guidance}`, { cause: error });
      Object.assign(session, candidate);
      const notice = { attempt: attempt + 1, source: error.source, before, after, window: config.model.maxContextTokens };
      session.contextRecovery = { ...notice, at: new Date().toISOString() };
      session.contextSnapshot = measureContext(config.model, system, session.messages, tools);
      // Durability before retry is mandatory; a failed save must prevent further requests.
      await options.onRecovery(notice);
      await runHooks(config, 'PostCompact', { sessionId: session.id, trigger: 'auto', source: 'provider-limit', archivedMessages: session.archivedMessages?.length ?? 0 }, session.cwd);
      await refineCompaction({ config, session, previousSummary, archiveOffset, persist: async () => {
        notice.after = countModelText(config.model,contextMessages(session.messages));
        session.contextSnapshot = measureContext(config.model, system, session.messages, tools);
        session.contextRecovery = { ...notice, at: new Date().toISOString() };
        await options.onRecovery(notice);
      } });
    }
  }
}
