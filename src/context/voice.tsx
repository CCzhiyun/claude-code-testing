export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking';
export class VoiceContext { private current: VoiceState = 'idle'; set(state: VoiceState): void { this.current = state; } get state(): VoiceState { return this.current; } }
