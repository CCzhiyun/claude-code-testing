import { semanticBoolean } from '../utils/semantic.js';
export interface VoiceModeContext { configured?: boolean; remote?: boolean; interactive?: boolean }
export function voiceModeEnabled(context: VoiceModeContext = {}): boolean { const configured = context.configured ?? semanticBoolean(process.env.CCPT_VOICE_ENABLED) ?? false; const remote = context.remote ?? semanticBoolean(process.env.CCPT_REMOTE) ?? false; const interactive = context.interactive ?? Boolean(process.stdin.isTTY); return configured && !remote && interactive; }
