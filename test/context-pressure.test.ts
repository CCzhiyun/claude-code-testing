import { expect, test } from 'bun:test';
import { defaultConfig } from '../src/config.js';
import { contextPressure, formatContextPressure, type ContextSnapshot } from '../src/contextBudget.js';
import { prepareContext, queryWithContextRecovery } from '../src/contextRecovery.js';
import { fullSessionMessages } from '../src/sessions.js';
import type { SessionRecord } from '../src/types.js';

test('context thresholds are >=90 warning and strictly >95 compact, including reserves', () => {
  for (const [percent, warn, compact] of [[89.9, false, false], [90, true, false], [95, true, false], [95.1, true, true]] as const) {
    const snapshot = { window: 10000, estimatedInput: percent * 100 - 1000, outputReserve: 500, safetyReserve: 500 } as ContextSnapshot;
    expect(contextPressure(snapshot)).toEqual({ percent, warn, compact });
  }
});
function fixture() {
  const config = structuredClone(defaultConfig); config.model.maxContextTokens = 4000; config.model.maxOutputTokens = 100;
  const session: SessionRecord = { id: 'fixture', title: '', cwd: '.', createdAt: '', updatedAt: '', messages: [] };
  for (let n = 0; n < 8; n++) session.messages.push({ role: 'user', content: '中'.repeat(500) }, { role: 'assistant', content: 'ok' });
  session.messages.push({ role: 'user', content: 'LATEST EXACT INPUT' });
  return { config, session };
}
test('proactive compaction archives original complete turns and resets warning band', () => {
  const { config, session } = fixture(); const original = structuredClone(session.messages);
  const notice = prepareContext(config, session, 'rules', []);
  expect(notice?.action).toBe('compacted'); expect(notice!.after).toBeLessThan(notice!.before);
  expect(fullSessionMessages(session)).toEqual(original); expect(session.messages.at(-1)).toEqual(original.at(-1));
  expect(session.contextWarningBand).toBe(0); expect(prepareContext(config, session, 'rules', [])).toBeUndefined();
});
test('disabled and impossible compaction give actionable notices without repeatedly warning or dropping the latest turn', () => {
  const { config, session } = fixture(); config.ui.autoCompact = false; const original = structuredClone(session.messages);
  const notice = prepareContext(config, session, '', []);
  expect(notice?.action).toBe('disabled'); expect(formatContextPressure(notice!)).toContain('disabled');
  expect(prepareContext(config, session, '', [])).toBeUndefined(); expect(session.messages).toEqual(original);
  config.ui.autoCompact = true; session.messages = [{ role: 'user', content: '中'.repeat(5000) }];
  expect(prepareContext(config, session, '', [])?.action).toBe('cannot-compact'); expect(session.messages[0]?.content).toBe('中'.repeat(5000));
});
test('90% warning is deduplicated until context falls below the threshold', () => {
  const { config, session } = fixture(); session.messages = [{ role: 'user', content: '中'.repeat(3350) }];
  expect(prepareContext(config, session, '', [])?.action).toBe('warning'); expect(prepareContext(config, session, '', [])).toBeUndefined();
  session.messages = [{ role: 'user', content: 'short' }]; expect(prepareContext(config, session, '', [])).toBeUndefined();
  session.messages = [{ role: 'user', content: '中'.repeat(3350) }]; expect(prepareContext(config, session, '', [])?.action).toBe('warning');
});
test('proactive compaction is durably saved before request and persistence failure prevents API spending', async () => {
  const { config, session } = fixture(); const order: string[] = [];
  await queryWithContextRecovery({ config, session, system: '', tools: [], async onPressure(notice) { order.push('save'); expect(notice.action).toBe('compacted'); }, async onRecovery() {}, async query() { order.push('query'); return { content: [] }; } });
  expect(order).toEqual(['save', 'query']);
  const next = fixture(); let queried = false;
  await expect(queryWithContextRecovery({ ...next, system: '', tools: [], async onPressure() { throw new Error('disk full'); }, async onRecovery() {}, async query() { queried = true; return { content: [] }; } })).rejects.toThrow('disk full');
  expect(queried).toBe(false);
});
