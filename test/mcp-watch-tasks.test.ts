import { expect, test } from 'bun:test';
import { defaultConfig } from '../src/config.js';
import { McpWatchTasks, activeMcpWatch, displayMcpData, mcpWatchItem } from '../src/mcpWatchTasks.js';
import type { McpWatchOptions, McpWatchResult } from '../src/mcpNotifications.js';

const result = (reason: McpWatchResult['reason'] = 'cancelled'): McpWatchResult => ({ reason, notifications: 0, reconnects: 0, deniedRequests: 0, pings: 0 });
function config() {
  const value = structuredClone(defaultConfig);
  value.mcpServers = Object.fromEntries(['one', 'two', 'three', 'four', 'five'].map(name => [name, { transport: 'http', httpMode: 'streamable', url: `https://${name}.example/mcp` }]));
  return value;
}
function fixture() {
  const calls: { options: McpWatchOptions; config: typeof defaultConfig; complete: (value: McpWatchResult) => void }[] = [];
  const manager = new McpWatchTasks(async (_name, value, options = {}) => new Promise(resolve => {
    calls.push({ options, config: value, complete: resolve });
    options.signal!.addEventListener('abort', () => resolve(result()), { once: true });
    options.onStatus?.({ state: 'connected', reconnects: 0 });
  }));
  return { manager, calls };
}

test('listeners are nonblocking, unique per server, bounded to four; stop/close abort and prevent restart', async () => {
  const { manager, calls } = fixture(); const settings = config();
  const first = manager.start('one', settings); manager.start('two', settings); manager.start('three', settings); manager.start('four', settings);
  expect(() => manager.start('one', settings)).toThrow('already active');
  expect(() => manager.start('five', settings)).toThrow('At most 4');
  await Bun.sleep(0); expect(calls.length).toBe(4);
  expect(manager.get(first.id).status).toBe('connected');
  calls[0]!.options.onDeniedRequest?.({ method: 'elicitation/create', reason: 'Capability not enabled' });
  expect(manager.get(first.id).events.join('\n')).toContain('client-request-denied');
  expect((await manager.stop(first.id)).status).toBe('cancelled');
  expect(calls[0]!.options.signal!.aborted).toBe(true);
  await manager.close(); expect(manager.list().some(activeMcpWatch)).toBe(false);
  expect(() => manager.start('one', settings)).toThrow('closed');
  await expect(manager.stop('not-local')).rejects.toThrow('Unknown');
});

test('notification ring retains 100 redacted entries, truncates oversized data and snapshots cannot mutate state', async () => {
  const { manager, calls } = fixture(); const first = manager.start('one', config()); await Bun.sleep(0);
  for (let i = 0; i < 103; i++) calls[0]!.options.onNotification!({ method: 'notifications/message', params: { i, authorization: 'private-secret', data: 'Hello' } });
  const saved = manager.get(first.id);
  expect(saved.notifications).toBe(103); expect(saved.events.length).toBe(100); expect(saved.dropped).toBe(3);
  expect(saved.events.join('')).not.toContain('private-secret');
  expect(saved.events[0]).toContain('"i":3');
  saved.events.length = 0; expect(manager.get(first.id).events.length).toBe(100);
  expect(displayMcpData({ text: 'x'.repeat(9000) })).toContain('omitted');
  expect(displayMcpData({ text: '\x1b[2J\u202ehello' })).not.toContain('\x1b');
  expect(mcpWatchItem(manager.get(first.id)).detail).toContain('not sent to the model');
  await manager.close();
  calls[0]!.options.onNotification!({ method: 'late' }); expect(manager.get(first.id).notifications).toBe(103);
});

test('configuration snapshots are independent; relevant policy changes revoke listeners but model changes do not', async () => {
  const { manager, calls } = fixture(); const settings = config(); const first = manager.start('one', settings);
  settings.model.name = 'new-model'; await Bun.sleep(0);
  expect(calls[0]!.config.model.name).not.toBe('new-model');
  manager.reconcile(settings); expect(manager.get(first.id).status).toBe('connected');
  settings.policy.allowNetwork = false; manager.reconcile(settings); await Bun.sleep(0);
  expect(manager.get(first.id).status).toBe('cancelled'); expect(manager.get(first.id).stopReason).toBe('configuration changed');
  await manager.close();
});

test('endpoint, CA, hook and server removal changes revoke the previous authority', async () => {
  for (const mutate of [
    (c: typeof defaultConfig) => { c.mcpServers.one!.url = 'https://changed.example'; },
    (c: typeof defaultConfig) => { c.network.caFile = 'changed-ca.pem'; },
    (c: typeof defaultConfig) => { c.hooks = [...c.hooks, { event: 'PermissionRequest', command: 'echo', args: ['changed'] } as any]; },
    (c: typeof defaultConfig) => { delete c.mcpServers.one; },
  ]) {
    const { manager } = fixture(); const settings = config(); const first = manager.start('one', settings); await Bun.sleep(0);
    mutate(settings); manager.reconcile(settings); await Bun.sleep(0);
    expect(manager.get(first.id).status).toBe('cancelled'); await manager.close();
  }
});

test('immediate close prevents handshakes; duration/protocol validation runs before launch', async () => {
  const { manager, calls } = fixture(); const settings = config();
  expect(() => manager.start('missing', settings)).toThrow('Streamable');
  expect(() => manager.start('one', settings, 0)).toThrow('durationMs');
  const first = manager.start('one', settings); await manager.close();
  expect(calls.length).toBe(0); expect(manager.get(first.id).status).toBe('cancelled');
});

test('failure is contained and redacted, terminal history is bounded and natural completion removes stop action', async () => {
  const failing = new McpWatchTasks(async () => { throw new Error('Authorization: Bearer sample-private-secret'); });
  const first = failing.start('one', config()); await Bun.sleep(0);
  expect(failing.get(first.id).status).toBe('failed'); expect(failing.get(first.id).error).not.toContain('sample-private-secret');
  await failing.close();
  const manager = new McpWatchTasks(async () => result('duration'));
  for (let i = 0; i < 24; i++) { manager.start('one', config()); await Bun.sleep(0); }
  expect(manager.list().length).toBe(16); expect(manager.list().every(task => task.status === 'completed')).toBe(true);
  expect(mcpWatchItem(manager.list()[0]!).actions).toEqual([]); await manager.close();
});
