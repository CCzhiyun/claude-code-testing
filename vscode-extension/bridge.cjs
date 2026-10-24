const { spawn } = require('node:child_process');
const readline = require('node:readline');

/** Reconnect the transport, never replay a model/tool/approval request. The new
 * subscription sends a current snapshot invalidation, not old authorization. */
class BridgeTransport {
  constructor(cwd, command, stateChanged, options = {}) {
    this.cwd = cwd; this.command = command; this.stateChanged = stateChanged;
    this.spawn = options.spawn || spawn;
    this.retryMs = options.retryMs || 500;
    this.requestTimeoutMs = options.requestTimeoutMs || 900000;
    this.eventCursor = options.cursor; this.persistCursor = options.onCursor;
    this.nextId = 1; this.pending = new Map(); this.attempts = 0; this.disposed = false;
    this.connect();
  }
  connect() {
    if (this.disposed) return;
    let child;
    try { child = this.spawn(this.command, ['ide', 'serve', '--cwd', this.cwd], { shell: process.platform === 'win32', windowsHide: true, stdio: 'pipe' }); }
    catch { this.scheduleReconnect(); return; }
    this.process = child;
    let lost = false;
    const lines = readline.createInterface({ input: child.stdout });
    const disconnect = () => {
      if (lost || this.process !== child) return;
      lost = true; this.connected = false; lines.close();
      this.rejectPending('CCPT bridge disconnected. Request outcome may be unknown; it was not replayed. Inspect session/Plan state before retrying.');
      child.kill(); this.scheduleReconnect();
    };
    child.on('error', disconnect); child.on('exit', disconnect);
    child.stdin.on('error', disconnect);
    // Drain stderr without forwarding configuration, credentials or raw prompts.
    child.stderr.on('data', () => {});
    lines.on('line', line => {
      if (lost || line.length > 4 * 1024 * 1024) return;
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.method === 'project/state' || message.method === 'project/state-error') { this.stateChanged.fire(message); if (message.method === 'project/state' && this.eventReplay) void this.drainEvents(); return; }
      if (message.method === 'runtime/event') { this.pending.get(message.params?.requestId)?.onEvent?.(message.params.event); return; }
      const pending = this.pending.get(message.id); if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
    child.once('spawn', () => {
      if (lost || this.disposed) return;
      this.connected = true;
      void this.request('project/watch', { enabled: true }).then(async result => {
        if (lost || this.disposed) return;
        this.eventReplay = result?.eventReplay === true;
        if (this.eventReplay) await this.drainEvents();
        this.attempts = 0;
        this.stateChanged.fire({ method: 'project/state', params: { reconnected: true, refresh: ['plans', 'teams', 'agents', 'sessions', 'reviews'] } });
      }).catch(disconnect);
    });
  }
  drainEvents() {
    if (this.draining) return this.draining;
    this.draining = (async () => {
      for (let page = 0; page < 8 && !this.disposed && this.connected; page++) {
        const result = await this.request('project/events', { ...(this.eventCursor ? { cursor: this.eventCursor } : {}), limit: 200 });
        if (!Array.isArray(result?.events) || result.events.length > 200 || !/^events_[a-f0-9]{16}:\d+$/.test(result.cursor)) throw new Error('Invalid project event replay response');
        const failed = Array.isArray(result.delivery) ? result.delivery.filter(row => row?.ok === false).map(row => row.producer).filter(name => ['plans','notifications'].includes(name)).sort().join(',') : '';
        if (failed !== (this.outboxFailure || '')) {
          this.outboxFailure = failed;
          this.stateChanged.fire({ method: failed ? 'project/outbox-error' : 'project/outbox-recovered', params: { message: failed ? 'Committed event delivery needs inspection: '+failed+'. Run ccpt event-outbox recover in this workspace. No approval/business action was replayed.' : 'Committed event delivery recovered.', replayIsAuthorization: false } });
        }
        if (result.reset) this.stateChanged.fire({ method: 'project/events-reset', params: { refreshRequired: true, replayIsAuthorization: false } });
        for (const event of result.events) this.stateChanged.fire({ method: 'project/event', params: { ...event, replayIsAuthorization: false } });
        this.eventCursor = result.cursor;
        await this.persistCursor?.(this.eventCursor);
        if (!result.hasMore) break;
      }
    })().catch(() => { if (!this.disposed) this.stateChanged.fire({ method: 'project/state-error', params: { message: 'Event catch-up failed; refresh current state before acting. No request was replayed.' } }); }).finally(() => { this.draining = undefined; });
    return this.draining;
  }
  scheduleReconnect() {
    if (this.disposed || this.timer || this.attempts >= 8) return;
    const delay = Math.min(30000, this.retryMs * 2 ** this.attempts++);
    this.timer = setTimeout(() => { this.timer = undefined; this.connect(); }, delay);
    this.timer.unref?.();
  }
  request(method, params = {}, onEvent) {
    if (this.disposed || !this.connected) return Promise.reject(new Error('CCPT bridge is disconnected; reconnect is automatic. No request was sent.'));
    if (this.pending.size >= 128) return Promise.reject(new Error('CCPT bridge pending-request limit reached'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('CCPT bridge response timed out. Execution was not cancelled or replayed; inspect its state before retrying.'));
      }, this.requestTimeoutMs);
      // Register before write: immediate replies must not be lost.
      this.pending.set(id, { resolve, reject, onEvent, timer });
      try { this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => {
        if (!error) return;
        const pending = this.pending.get(id); if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(id); reject(new Error('Bridge write failed; request outcome is unknown and was not replayed.'));
      }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  rejectPending(message) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear();
  }
  dispose() {
    this.disposed = true; this.connected = false; clearTimeout(this.timer); this.timer = undefined;
    this.rejectPending('CCPT bridge disposed; pending requests were not replayed.');
    this.process?.kill();
  }
}
module.exports = { BridgeTransport };
