import { test, expect } from 'bun:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig } from '../src/config.js';
import { executeCommand } from '../src/policy.js';
import { networkRequest } from '../src/network.js';
import { withExecutionSignal } from '../src/executionControl.js';

test('cancelling a streaming request releases the socket without waiting for network timeout', async () => {
  let accepted!: () => void;
  const ready = new Promise<void>((resolve) => { accepted = resolve; });
  const server = createServer((_req, res) => { res.writeHead(200); res.write('partial'); accepted(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const controller = new AbortController();
    const request = withExecutionSignal(controller.signal, () => networkRequest(`http://127.0.0.1:${(server.address() as { port: number }).port}`, {}, defaultConfig.network));
    const outcome = request.catch((error: unknown) => error);
    await ready;
    controller.abort();
    expect(String(await outcome)).toContain('cancelled');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('pre-cancelled execution cannot start a command or request', async () => {
  const controller = new AbortController(); controller.abort();
  const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [process.cwd()];
  await expect(withExecutionSignal(controller.signal, () => executeCommand('node', ['--version'], process.cwd(), config))).rejects.toThrow();
  await expect(withExecutionSignal(controller.signal, () => networkRequest('http://127.0.0.1:1', {}, config.network))).rejects.toThrow();
});

test('cancelling an owned command terminates its child process too', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ccpt-cancel-tree-'));
  await writeFile(join(cwd, 'parent.cjs'), `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync('child.pid',String(child.pid));setInterval(()=>{},1000);`);
  const config = structuredClone(defaultConfig); config.policy.workspaceRoots = [cwd]; config.policy.commandTimeoutMs = 20_000;
  const controller = new AbortController();
  const command = withExecutionSignal(controller.signal, () => executeCommand('node', ['parent.cjs'], cwd, config));
  const outcome = command.catch((error: unknown) => error);
  let pid = 0;
  try {
    for (let i = 0; i < 100; i++) {
      try { const value=Number(await readFile(join(cwd,'child.pid'),'utf8'));if(Number.isSafeInteger(value)&&value>1){pid=value;break;} }catch{}
      // Exclusive creation and writing are distinct filesystem steps. An empty
      // freshly-created file is not a valid PID or a finished startup signal.
      await Bun.sleep(30);
    }
    expect(pid).toBeGreaterThan(0);
    controller.abort(); expect(String(await outcome)).toContain('cancelled');
    let alive = true;
    for (let i = 0; i < 100; i++) { try { process.kill(pid, 0); await Bun.sleep(30); } catch { alive = false; break; } }
    expect(alive).toBe(false);
  } finally { controller.abort(); }
}, 15_000);
