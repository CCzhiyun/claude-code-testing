import type { SessionRecord } from '../types.js';
import type { TranscriptEntry } from '../tui/presentation.js';
import { isSummaryMessage } from '../sessions.js';
import { parsePermissionRequest } from '../permissionApprovals.js';

/** Render persisted conversation without starting a worker or replaying any tool. */
export function sessionTranscript(session: SessionRecord): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  if (session.summary) entries.push({ role: 'system', text: `Saved context summary\n${session.summary}` });
  for (const message of session.messages) {
    if (isSummaryMessage(message)) continue;
    if (typeof message.content === 'string') { entries.push({ role: message.role, text: message.content }); continue; }
    for (const block of message.content) {
      if (block.type === 'text') entries.push({ role: message.role, text: block.text ?? '' });
      else if (block.type === 'tool_use') entries.push({ role: 'tool', text: '', name: block.name ?? 'Tool', input: block.input ?? {} });
      else if (block.type === 'tool_result') entries.push({ role: 'tool_result', text: parsePermissionRequest(block.content) ? 'Tool requested explicit permission; see the recorded user decision.' : block.content ?? '', isError: block.is_error ?? false });
      else if (block.type === 'image') entries.push({ role: message.role, text: '[Saved image attachment]' });
      else if (block.type === 'thinking') entries.push({ role: 'thinking', text: 'Saved reasoning', detail: block.text ?? 'Redacted reasoning block' });
    }
  }
  return entries;
}
