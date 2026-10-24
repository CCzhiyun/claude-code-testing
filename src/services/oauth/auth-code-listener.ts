import { createServer, type Server, type ServerResponse } from 'node:http';
import { verifyState } from './crypto.js';

export class AuthCodeListener {
  private server: Server | undefined;
  private response: ServerResponse | undefined;
  private port = 0;

  constructor(private readonly callbackPath = '/callback') {}

  async start(port = 0): Promise<number> {
    this.server = createServer();
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('OAuth listener has no port');
    this.port = address.port;
    return this.port;
  }

  getPort(): number {
    return this.port;
  }

  waitForAuthorization(expectedState: string, timeoutMs = 120_000): Promise<string> {
    if (!this.server) throw new Error('OAuth listener has not started');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('OAuth authorization timed out')), timeoutMs);
      timer.unref?.();
      this.server!.on('request', (request, response) => {
        const url = new URL(request.url ?? '', `http://127.0.0.1:${this.port}`);
        if (url.pathname !== this.callbackPath) {
          response.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        if (!code || !state || !verifyState(state, expectedState)) {
          response.writeHead(400).end('Invalid OAuth callback');
          clearTimeout(timer);
          reject(new Error(!code ? 'Authorization code not found' : 'Invalid OAuth state'));
          return;
        }
        this.response = response;
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  complete(success: boolean): void {
    this.response
      ?.writeHead(success ? 200 : 400, { 'content-type': 'text/plain; charset=utf-8' })
      .end(success ? 'Authorization complete. You can close this window.' : 'Authorization failed.');
    this.response = undefined;
    this.close();
  }

  close(): void {
    this.server?.close();
    this.server = undefined;
  }
}
