import { currentLimits, statusListeners, type ClaudeAILimits } from './claudeAiLimits.js';
export function subscribeClaudeAiLimits(listener: (limits: ClaudeAILimits) => void): () => void { statusListeners.add(listener); listener({ ...currentLimits }); return () => statusListeners.delete(listener); }
