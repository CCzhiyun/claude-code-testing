export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'open' | 'message' | 'close' | 'error', listener: (event: any) => void): void;
}

export type WebSocketFactory = (url: string, protocols?: string[]) => WebSocketLike;

export interface SessionsWebSocketOptions {
  token?: string;
  reconnectAttempts?: number;
  reconnectDelayMs?: number;
  pingIntervalMs?: number;
  factory?: WebSocketFactory;
  onMessage?: (message: unknown) => void | Promise<void>;
  onStateChange?: (state: 'connecting' | 'open' | 'reconnecting' | 'closed') => void;
}

function defaultFactory(url: string, protocols?: string[]): WebSocketLike {
  const Constructor = globalThis.WebSocket;
  if (!Constructor) throw new Error('This runtime does not provide WebSocket support');
  return new Constructor(url, protocols) as unknown as WebSocketLike;
}

export class SessionsWebSocket {
  private socket?: WebSocketLike;
  private attempts = 0;
  private closedByUser = false;
  private pingTimer?: ReturnType<typeof setInterval>;
  private lineBuffer = '';

  constructor(private readonly url: string, private readonly options: SessionsWebSocketOptions = {}) {}

  connect(): void {
    this.closedByUser = false;
    this.options.onStateChange?.(this.attempts ? 'reconnecting' : 'connecting');
    const protocols = this.options.token ? ['ccpt', `bearer.${Buffer.from(this.options.token).toString('base64url')}`] : undefined;
    const socket = (this.options.factory ?? defaultFactory)(this.url, protocols);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.attempts = 0;
      this.options.onStateChange?.('open');
      const interval = this.options.pingIntervalMs ?? 30_000;
      this.pingTimer = setInterval(() => this.send({ type: 'ping', timestamp: Date.now() }), interval);
      this.pingTimer.unref?.();
    });
    socket.addEventListener('message', (event) => { void this.consume(typeof event.data === 'string' ? event.data : String(event.data)); });
    socket.addEventListener('error', () => { /* close event decides whether to retry */ });
    socket.addEventListener('close', (event) => this.handleClose(Number(event.code ?? 1006)));
  }

  send(message: unknown): void {
    if (!this.socket || this.socket.readyState !== 1) throw new Error('Remote session is not connected');
    this.socket.send(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    this.closedByUser = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.socket?.close(1000, 'client disconnect');
    this.options.onStateChange?.('closed');
  }

  private async consume(chunk: string): Promise<void> {
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try { await this.options.onMessage?.(JSON.parse(line) as unknown); }
      catch { await this.options.onMessage?.({ type: 'protocol_error', error: 'invalid_json' }); }
    }
  }

  private handleClose(code: number): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.closedByUser || code === 4003) { this.options.onStateChange?.('closed'); return; }
    const limit = this.options.reconnectAttempts ?? 5;
    if (this.attempts >= limit) { this.options.onStateChange?.('closed'); return; }
    this.attempts += 1;
    this.options.onStateChange?.('reconnecting');
    const delay = (this.options.reconnectDelayMs ?? 1_000) * Math.min(this.attempts, 10);
    const timer = setTimeout(() => this.connect(), delay);
    timer.unref?.();
  }
}
