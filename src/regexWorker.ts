import { Worker } from 'node:worker_threads';
import { executionSignal } from './executionControl.js';

const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
let expression;
try { expression = new RegExp(workerData.pattern, 'i'); }
catch { parentPort.postMessage({error:'Invalid search regular expression'}); }
parentPort.on('message', ({text,limit}) => {
  if (!expression) return;
  const result=[]; const lines=text.split(/\\r?\\n/);
  for(let i=0;i<lines.length;i++) if(expression.test(lines[i])) {
    result.push({line:i+1,text:lines[i].slice(0,2000)});
    if(result.length>=limit) break;
  }
  parentPort.postMessage({result});
});`;

/** A pathological regex must not block the UI heartbeat or cancellation loop. */
export class BoundedRegexMatcher {
  private worker: Worker;
  private closed = false;
  constructor(pattern: string, private timeoutMs = 500) {
    if (pattern.length > 1000) throw new Error('Search expression is too long');
    try { new RegExp(pattern, 'i'); } catch { throw new Error('Invalid search regular expression'); }
    this.worker = new Worker(workerSource, { eval: true, workerData: { pattern }, resourceLimits: { maxOldGenerationSizeMb: 64, stackSizeMb: 4 } });
    // Match attaches per-request listeners; absorb errors during initialization/disposal.
    this.worker.on('error', () => {});
  }
  async match(text: string, limit: number): Promise<Array<{ line: number; text: string }>> {
    if (this.closed) throw new Error('Search worker is closed');
    const signal = executionSignal(); signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.worker.off('message', message); this.worker.off('error', error); this.worker.off('exit', exit); };
      const fail = (reason: Error) => { cleanup(); void this.close(); reject(reason); };
      const abort = () => fail(new Error('Search cancelled'));
      const error = () => fail(new Error('Search worker failed or exceeded its memory limit'));
      const exit = () => fail(new Error('Search worker exited unexpectedly'));
      const message = (value: { error?: string; result?: Array<{ line: number; text: string }> }) => { if (value.error) fail(new Error(value.error)); else if (value.result) { cleanup(); resolve(value.result); } };
      const timer = setTimeout(() => fail(new Error('Search regular expression exceeded its execution time limit')), this.timeoutMs);
      this.worker.once('message', message); this.worker.once('error', error); this.worker.once('exit', exit);
      signal?.addEventListener('abort', abort, { once: true });
      this.worker.postMessage({ text, limit });
    });
  }
  async close(): Promise<void> { if (!this.closed) { this.closed = true; await this.worker.terminate(); } }
}
