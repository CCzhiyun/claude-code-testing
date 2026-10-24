import type { ModelMessage } from '../../types.js';
import { estimateMessageTokens } from './microCompact.js';
import { shouldShowCompactWarning } from './compactWarningState.js';
export function compactWarning(messages: ModelMessage[], maxContextTokens: number): string | undefined { const usage = estimateMessageTokens(messages) / maxContextTokens; return usage >= 0.8 && shouldShowCompactWarning() ? `Context usage is approximately ${Math.round(usage * 100)}%; compaction may run soon.` : undefined; }
