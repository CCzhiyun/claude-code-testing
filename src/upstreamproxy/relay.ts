import { createServer, type Socket } from 'node:net';
import WebSocket from 'ws';

const MAX_HEADER_BYTES = 8_192;
const MAX_CHUNK_BYTES = 512 * 1024;

export function encodeChunk(data: Uint8Array): Uint8Array {
  const length: number[] = []; let value = data.length;
  while (value > 0x7f) { length.push((value & 0x7f) | 0x80); value >>>= 7; }
  length.push(value);
  const output = new Uint8Array(1 + length.length + data.length); output[0] = 0x0a; output.set(length, 1); output.set(data, 1 + length.length); return output;
}

export function decodeChunk(buffer: Uint8Array): Uint8Array | null {
  if (buffer.length === 0) return new Uint8Array();
  if (buffer[0] !== 0x0a) return null;
  let length = 0, shift = 0, index = 1;
  for (; index < buffer.length; index += 1) { const byte = buffer[index]!; length |= (byte & 0x7f) << shift; if ((byte & 0x80) === 0) { index += 1; break; } shift += 7; if (shift > 28) return null; }
  return index + length <= buffer.length ? buffer.subarray(index, index + length) : null;
}

export interface UpstreamProxyRelay { port: number; stop(): Promise<void> }

export async function startUpstreamProxyRelay(options: { wsUrl: string; sessionId: string; token: string }): Promise<UpstreamProxyRelay> {
  const wsUrl = new URL(options.wsUrl);
  if (!['ws:', 'wss:'].includes(wsUrl.protocol)) throw new Error('Upstream relay requires a WebSocket URL');
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket); socket.once('close', () => sockets.delete(socket));
    let header = Buffer.alloc(0); let tunnel: WebSocket | undefined; const pending: Buffer[] = [];
    socket.on('data', (data) => {
      if (tunnel) { if (tunnel.readyState === WebSocket.OPEN) sendChunks(tunnel, data); else pending.push(Buffer.from(data)); return; }
      header = Buffer.concat([header, data]);
      if (header.length > MAX_HEADER_BYTES) { socket.end('HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n'); return; }
      const end = header.indexOf('\r\n\r\n'); if (end < 0) return;
      const head = header.subarray(0, end).toString('utf8'); const firstLine = head.split('\r\n')[0] ?? '';
      if (!/^CONNECT\s+[^\s]+\s+HTTP\/1\.[01]$/i.test(firstLine)) { socket.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n'); return; }
      const trailing = header.subarray(end + 4); if (trailing.length) pending.push(Buffer.from(trailing));
      const authorization = `Bearer ${options.token}`;
      tunnel = new WebSocket(wsUrl, { headers: { authorization, 'content-type': 'application/proto' } });
      tunnel.binaryType = 'arraybuffer';
      tunnel.on('open', () => {
        const proxyAuthorization = Buffer.from(`${options.sessionId}:${options.token}`).toString('base64');
        tunnel!.send(encodeChunk(Buffer.from(`${firstLine}\r\nProxy-Authorization: Basic ${proxyAuthorization}\r\n\r\n`)));
        for (const chunk of pending) sendChunks(tunnel!, chunk); pending.length = 0;
      });
      tunnel.on('message', (value) => { const decoded = decodeChunk(new Uint8Array(value as ArrayBuffer)); if (decoded?.length) socket.write(decoded); });
      tunnel.on('error', () => { if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); });
      tunnel.on('close', () => socket.end());
      socket.once('close', () => { if (tunnel?.readyState === WebSocket.OPEN) tunnel.close(); });
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Upstream relay failed to bind');
  return { port: address.port, stop: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); } };
}

function sendChunks(socket: WebSocket, data: Buffer): void { for (let offset = 0; offset < data.length; offset += MAX_CHUNK_BYTES) socket.send(encodeChunk(data.subarray(offset, offset + MAX_CHUNK_BYTES))); }
