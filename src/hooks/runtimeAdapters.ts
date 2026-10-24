import { ReactiveValue } from './value.js';

export interface RuntimeHookState<T = unknown> { ready: boolean; value?: T; error?: string; updatedAt?: string }
export type RuntimeHookDisposer = () => void | Promise<void>;
export interface RuntimeHookAdapter<T = unknown> { start(publish: (state: RuntimeHookState<T>) => void, signal: AbortSignal): RuntimeHookDisposer | Promise<RuntimeHookDisposer> }

export class RuntimeHook<T = unknown> {
  readonly state = new ReactiveValue<RuntimeHookState<T>>({ ready: false });
  #controller: AbortController | undefined;
  #dispose: RuntimeHookDisposer | undefined;
  constructor(readonly name: string, readonly adapter: RuntimeHookAdapter<T>) {}
  async start(): Promise<void> {
    await this.stop();
    const controller = new AbortController(); this.#controller = controller;
    const publish = (state: RuntimeHookState<T>): void => { if (!controller.signal.aborted) this.state.set({ ...state, updatedAt: state.updatedAt ?? new Date().toISOString() }); };
    try { this.#dispose = await this.adapter.start(publish, controller.signal); }
    catch (error) { publish({ ready: false, error: error instanceof Error ? error.message : String(error) }); }
  }
  async stop(): Promise<void> { this.#controller?.abort(); this.#controller = undefined; const dispose = this.#dispose; this.#dispose = undefined; await dispose?.(); }
}

export function eventHook<T>(initial?: T): { adapter: RuntimeHookAdapter<T>; publish(value: T): void } {
  let listener: ((state: RuntimeHookState<T>) => void) | undefined;
  return {
    adapter: { start(publish) { listener = publish; if (initial !== undefined) publish({ ready: true, value: initial }); return () => { listener = undefined; }; } },
    publish(value) { listener?.({ ready: true, value }); },
  };
}

export function pollingHook<T>(load: () => Promise<T>, intervalMs = 5_000): RuntimeHookAdapter<T> {
  if (!Number.isFinite(intervalMs) || intervalMs < 10) throw new Error('Hook polling interval must be at least 10ms');
  return { start(publish, signal) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (): Promise<void> => {
      try { publish({ ready: true, value: await load() }); }
      catch (error) { publish({ ready: false, error: error instanceof Error ? error.message : String(error) }); }
      if (!signal.aborted) timer = setTimeout(() => void poll(), intervalMs);
    };
    void poll();
    return () => { if (timer) clearTimeout(timer); };
  } };
}

export function afterFirstRender(callback: () => void): RuntimeHookAdapter<boolean> {
  let completed = false;
  return { start(publish) { if (!completed) { completed = true; callback(); } publish({ ready: true, value: true }); return () => {}; } };
}

export type HookAdapterFamily = 'lifecycle' | 'model' | 'session' | 'permission' | 'notification' | 'ide' | 'remote' | 'plugin' | 'skill' | 'agent' | 'voice' | 'data';
export const REFERENCE_HOOK_ADAPTERS = Object.freeze({
  useAfterFirstRender: 'lifecycle', useApiKeyVerification: 'model', useAssistantHistory: 'session', useAwaySummary: 'session', useCanUseTool: 'permission',
  useChromeExtensionNotification: 'notification', useClaudeCodeHintRecommendation: 'notification', useDiffData: 'data', useDiffInIDE: 'ide', useDirectConnect: 'remote',
  useDynamicConfig: 'data', useExitOnCtrlCD: 'lifecycle', useFileHistorySnapshotInit: 'data', useIDEIntegration: 'ide', useIdeAtMentioned: 'ide', useIdeConnectionStatus: 'ide',
  useIdeLogging: 'ide', useIdeSelection: 'ide', useInboxPoller: 'agent', useIssueFlagBanner: 'notification', useLogMessages: 'data', useLspPluginRecommendation: 'plugin',
  useMailboxBridge: 'agent', useMainLoopModel: 'model', useManagePlugins: 'plugin', useOfficialMarketplaceNotification: 'plugin', usePluginRecommendationBase: 'plugin',
  usePrStatus: 'ide', usePromptsFromClaudeInChrome: 'remote', useReplBridge: 'remote', useSSHSession: 'remote', useSkillImprovementSurvey: 'skill', useSkillsChange: 'skill',
  useSwarmInitialization: 'agent', useSwarmPermissionPoller: 'permission', useTeammateViewAutoExit: 'agent', useTeleportResume: 'remote', useUpdateNotification: 'notification',
  useVoiceEnabled: 'voice', useVoiceIntegration: 'voice',
} satisfies Record<string, HookAdapterFamily>);

export function referenceHookFamily(reference: string): HookAdapterFamily | undefined { return REFERENCE_HOOK_ADAPTERS[reference.replace(/^.*\//, '').replace(/\.(?:tsx?|jsx?)$/, '') as keyof typeof REFERENCE_HOOK_ADAPTERS]; }
