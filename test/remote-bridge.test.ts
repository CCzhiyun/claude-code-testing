import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { createDirectConnectSession } from '../src/server/createDirectConnectSession.js';
import { SessionsWebSocket, type WebSocketLike } from '../src/remote/SessionsWebSocket.js';
import { RemotePermissionBridge } from '../src/remote/remotePermissionBridge.js';
import { signJwt, verifyJwt } from '../src/bridge/jwtUtils.js';
import { saveInboundAttachment } from '../src/bridge/inboundAttachments.js';
import { InboundMessageValidator } from '../src/bridge/inboundMessages.js';
import { buildBridgeWebSocketUrl, decodeWorkSecret, sameSessionId } from '../src/bridge/workSecret.js';
import { FlushGate } from '../src/bridge/flushGate.js';
import { resolvePollConfig } from '../src/bridge/pollConfig.js';
import { BridgeMessageQueue } from '../src/bridge/bridgeMessaging.js';
import { bridgeStatus } from '../src/bridge/bridgeStatusUtil.js';
import { canonicalSessionId } from '../src/bridge/sessionIdCompat.js';

let authorization = '';
const server = Bun.serve({
  port: 0,
  fetch(request) {
    authorization = request.headers.get('authorization') ?? '';
    return Response.json({ session_id: 'session-1', ws_url: 'ws://127.0.0.1:9999/connect', work_dir: '/work' });
  },
});
afterAll(() => server.stop(true));

describe('Direct Connect and remote bridge', () => {
  test('creates and validates a Direct Connect session without persisting credentials', async () => {
    const session = await createDirectConnectSession(
      { baseUrl: `http://127.0.0.1:${server.port}`, token: 'top-secret' },
      { cwd: '/work', bypassPermissions: true },
      structuredClone(defaultConfig.network),
    );
    expect(session).toMatchObject({ sessionId: 'session-1', state: 'starting', workDir: '/work' });
    expect(authorization).toBe('Bearer top-secret');
    expect(JSON.stringify(session)).not.toContain('top-secret');
  });

  test('parses line-delimited events and reconnects transient closures', async () => {
    const sockets: FakeSocket[] = [];
    const messages: unknown[] = [];
    const states: string[] = [];
    const transport = new SessionsWebSocket('ws://local/session', {
      reconnectAttempts: 1,
      reconnectDelayMs: 1,
      pingIntervalMs: 60_000,
      factory: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; },
      onMessage: (message) => { messages.push(message); },
      onStateChange: (state) => { states.push(state); },
    });
    transport.connect(); sockets[0]!.open();
    sockets[0]!.message('{"type":"one"}\n{"type":"two"}\n');
    sockets[0]!.closeFromServer(4001);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(messages).toEqual([{ type: 'one' }, { type: 'two' }]);
    expect(sockets).toHaveLength(2);
    expect(states).toContain('reconnecting');
    transport.close();
  });

  test('tracks expiring remote permission requests exactly once', async () => {
    const bridge = new RemotePermissionBridge();
    const request = { requestId: 'r-1', sessionId: 's-1', tool: 'Bash', input: { command: 'git status' }, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10_000).toISOString() };
    await bridge.receive(request);
    await expect(bridge.receive(request)).rejects.toThrow('Duplicate');
    expect((await bridge.resolve('r-1', 'deny')).tool).toBe('Bash');
    await expect(bridge.resolve('r-1', 'allow')).rejects.toThrow('Unknown or expired');
  });

  test('signs and strictly verifies scoped short-lived JWTs', () => {
    const now = Math.floor(Date.now() / 1000);
    const secret = 'x'.repeat(32);
    const token = signJwt({ iss: 'ccpt', aud: 'bridge', jti: 'once', iat: now, exp: now + 60 }, secret);
    expect(verifyJwt(token, secret, { issuer: 'ccpt', audience: 'bridge', now }).jti).toBe('once');
    expect(() => verifyJwt(`${token.slice(0, -1)}x`, secret, { issuer: 'ccpt', audience: 'bridge', now })).toThrow('signature');
    expect(() => verifyJwt(token, secret, { issuer: 'ccpt', audience: 'other', now })).toThrow('issuer or audience');
  });

  test('validates, bounds and safely writes inbound attachments', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ccpt-remote-'));
    try {
      const path = await saveInboundAttachment(workspace, 'm-1', { id: 'a-1', fileName: '../hello.txt', mediaType: 'text/plain', contentBase64: Buffer.from('hello').toString('base64') }, { maxBytes: 10, workspaceRoots: [workspace] });
      expect(await readFile(path, 'utf8')).toBe('hello');
      expect(path.startsWith(workspace)).toBe(true);
      await expect(saveInboundAttachment(workspace, 'm-2', { id: 'a-2', fileName: 'large.txt', mediaType: 'text/plain', contentBase64: Buffer.from('too large content').toString('base64') }, { maxBytes: 2, workspaceRoots: [workspace] })).rejects.toThrow('size limit');
    } finally { await rm(workspace, { recursive: true, force: true }); }
  });

  test('enforces message deduplication and bridge protocol configuration', () => {
    const validator = new InboundMessageValidator();
    const message = { id: 'm1', sessionId: 's1', kind: 'interrupt', createdAt: new Date().toISOString(), payload: {} };
    expect(validator.validate(message, 's1').kind).toBe('interrupt');
    expect(() => validator.validate(message, 's1')).toThrow('Duplicate');
    const encoded = Buffer.from(JSON.stringify({ version: 1, session_ingress_token: 'secret', api_base_url: 'https://bridge.example/api', session_id: 'session:ABC' })).toString('base64url');
    const secret = decodeWorkSecret(encoded);
    expect(buildBridgeWebSocketUrl(secret)).toBe('wss://bridge.example/v2/sessions/connect');
    expect(sameSessionId(secret.sessionId!, 'abc')).toBe(true);
    expect(resolvePollConfig().livenessTimeoutMs).toBeGreaterThan(resolvePollConfig().requestTimeoutMs);
  });

  test('flush gate preserves ordering and deactivates safely', () => {
    const gate = new FlushGate<number>();
    expect(gate.enqueue(0)).toBe(false);
    gate.start(); gate.enqueue(1); gate.enqueue(2);
    expect(gate.end()).toEqual([1, 2]);
    gate.deactivate();
    expect(gate.enqueue(3)).toBe(false);
    expect(() => gate.start()).toThrow('deactivated');
  });

  test('orders outbound events, rejects regressive ACKs, and detects stale sessions', () => {
    const queue = new BridgeMessageQueue('s1');
    queue.enqueue('status', { state: 'running' });
    queue.enqueue('interrupt', {});
    expect(queue.batch().map((event) => event.sequence)).toEqual([1, 2]);
    expect(queue.acknowledge(1)).toBe(1);
    expect(() => queue.acknowledge(0)).toThrow('regressive');
    expect(bridgeStatus({ version: 1, sessionId: 's1', state: 'connected', serverOrigin: 'https://example.com', createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString() }, Date.now(), 100).state).toBe('degraded');
    expect(canonicalSessionId('session:ABC_1')).toBe('ABC_1');
  });
});

class FakeSocket implements WebSocketLike {
  readyState = 0;
  private listeners = new Map<string, Array<(event: any) => void>>();
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void {
    const values = this.listeners.get(type) ?? []; values.push(listener); this.listeners.set(type, values);
  }
  send(_data: string): void {}
  close(code = 1000): void { this.readyState = 3; this.emit('close', { code }); }
  open(): void { this.readyState = 1; this.emit('open', {}); }
  message(data: string): void { this.emit('message', { data }); }
  closeFromServer(code: number): void { this.readyState = 3; this.emit('close', { code }); }
  private emit(type: string, event: unknown): void { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}
