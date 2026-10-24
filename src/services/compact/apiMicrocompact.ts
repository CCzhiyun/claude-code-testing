import type { ModelMessage } from '../../types.js';
import { estimateMessageTokens, microcompactMessages } from './microCompact.js';
export function apiMicrocompact(messages: ModelMessage[], targetTokens: number): ModelMessage[] { let retain = 10; let result = structuredClone(messages); while (retain > 1 && estimateMessageTokens(result) > targetTokens) { retain -= 1; result = microcompactMessages(messages, retain).messages; } return result; }
