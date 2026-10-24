import type { SessionRecord } from '../../types.js';
import { estimateMessageTokens } from './microCompact.js';
import { compact, type CompactionResult } from './compact.js';
/** Low-level helper; Agent runtime uses full request contextPressure including reserves. */
export function shouldAutoCompact(session: SessionRecord, maxContextTokens: number, threshold = 0.95): boolean { return estimateMessageTokens(session.messages) > maxContextTokens * threshold; }
export function autoCompact(session: SessionRecord, maxContextTokens: number): CompactionResult | undefined { return shouldAutoCompact(session, maxContextTokens) ? compact(session, maxContextTokens) : undefined; }
