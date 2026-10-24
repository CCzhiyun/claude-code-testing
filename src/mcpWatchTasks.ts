import { createHash, randomUUID } from 'node:crypto';
import { watchMcpServer } from './mcp.js';
import { validateWatchOptions, type McpWatchOptions, type McpWatchResult } from './mcpNotifications.js';
import { configForDisplay } from './configDisplay.js';
import type { PlatformConfig } from './types.js';
import type { ResourceItem } from './components/resourceDialog.js';

export interface McpWatchTask {
  id: string;
  server: string;
  status: 'connecting' | 'connected' | 'reconnecting' | 'stopping' | 'completed' | 'cancelled' | 'failed';
  notifications: number;
  reconnects: number;
  dropped: number;
  events: string[];
  result?: McpWatchResult;
  error?: string;
  stopReason?: string;
}
type Watcher = typeof watchMcpServer;
interface Entry { task: McpWatchTask; controller: AbortController; done: Promise<void>; fingerprint: string }
export const activeMcpWatch = (task: McpWatchTask): boolean => ['connecting', 'connected', 'reconnecting', 'stopping'].includes(task.status);

// Bound data before walking it: notifications are untrusted, potentially deeply nested JSON.
export function displayMcpData(value: unknown): string {
  try {
    const raw = JSON.stringify(value);
    if (raw.length > 8000) return '[notification omitted: display size limit]';
    return JSON.stringify(configForDisplay(value)).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, 4000);
  } catch { return '[notification omitted: unsupported data]'; }
}

function fingerprint(config: PlatformConfig, server: string): string {
  return createHash('sha256').update(JSON.stringify({ server: config.mcpServers[server], credentials: config.mcpCredentialBackend, policy: config.policy, network: config.network, hooks: config.hooks })).digest('hex');
}

/** Session-owned listeners. No worker, disk persistence, model dispatch or automatic restart. */
export class McpWatchTasks {
  readonly #entries = new Map<string, Entry>();
  #closed = false;
  constructor(private readonly watcher: Watcher = watchMcpServer) {}

  start(server: string, config: PlatformConfig, durationMs = 60000): McpWatchTask {
    if (this.#closed) throw new Error('MCP listener manager is closed');
    validateWatchOptions({ durationMs });
    const definition = config.mcpServers[server];
    if (!definition || definition.transport !== 'http' || definition.httpMode !== 'streamable') throw new Error('MCP watch requires a configured HTTP Streamable server');
    const active = [...this.#entries.values()].filter(entry => activeMcpWatch(entry.task));
    if (active.some(entry => entry.task.server === server)) throw new Error('An MCP listener for this server is already active');
    if (active.length >= 4) throw new Error('At most 4 MCP listeners may run in this terminal');
    if (this.#entries.size >= 16) {
      const old = [...this.#entries.values()].find(entry => !activeMcpWatch(entry.task));
      if (old) this.#entries.delete(old.task.id);
    }
    const snapshot = structuredClone(config);
    const task: McpWatchTask = { id: `mcpwatch_${randomUUID()}`, server, status: 'connecting', notifications: 0, reconnects: 0, dropped: 0, events: [] };
    const entry: Entry = { task, controller: new AbortController(), done: Promise.resolve(), fingerprint: fingerprint(config, server) };
    this.#entries.set(task.id, entry);
    const options: McpWatchOptions = {
      durationMs, signal: entry.controller.signal,
      onDeniedRequest: notice => {
        if (entry.controller.signal.aborted) return;
        if (task.events.length >= 100) { task.events.shift(); task.dropped++; }
        task.events.push(displayMcpData({ type: 'client-request-denied', ...notice }));
      },
      onStatus: status => { if (!entry.controller.signal.aborted) { task.status = status.state; task.reconnects = status.reconnects; } },
      onNotification: notification => {
        if (entry.controller.signal.aborted) return;
        task.notifications++;
        if (task.events.length >= 100) { task.events.shift(); task.dropped++; }
        task.events.push(displayMcpData(notification));
      },
    };
    // Schedule after registration so immediate failures and stop-before-start are tracked.
    entry.done = Promise.resolve().then(() => {
      entry.controller.signal.throwIfAborted();
      return this.watcher(server, snapshot, options);
    }).then(result => {
      task.result = result;
      task.status = entry.controller.signal.aborted || result.reason === 'cancelled' ? 'cancelled' : 'completed';
    }).catch(error => {
      task.status = entry.controller.signal.aborted ? 'cancelled' : 'failed';
      if (task.status === 'failed') task.error = displayMcpData(error instanceof Error ? error.message : 'MCP watch failed');
    });
    return structuredClone(task);
  }

  list(): McpWatchTask[] { return [...this.#entries.values()].map(entry => structuredClone(entry.task)); }
  get(id: string): McpWatchTask {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error('Unknown MCP listener in this terminal');
    return structuredClone(entry.task);
  }
  async stop(id: string, reason = 'user request'): Promise<McpWatchTask> {
    const entry = this.#entries.get(id);
    if (!entry) throw new Error('Unknown MCP listener in this terminal');
    if (activeMcpWatch(entry.task)) {
      entry.task.status = 'stopping'; entry.task.stopReason = reason; entry.controller.abort();
      await entry.done;
    }
    return this.get(id);
  }
  /** Revoke on loaded configuration changes. Never silently reconnect using stale authority. */
  reconcile(config: PlatformConfig): void {
    for (const entry of this.#entries.values()) if (activeMcpWatch(entry.task) && entry.fingerprint !== fingerprint(config, entry.task.server)) void this.stop(entry.task.id, 'configuration changed');
  }
  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all([...this.#entries.keys()].map(id => this.stop(id, 'terminal closed')));
  }
}

export function mcpWatchItem(task: McpWatchTask): ResourceItem {
  return {
    id: task.id, label: `MCP ${task.server} · ${task.status}`, description: `${task.notifications} notifications · ${task.reconnects} reconnects`,
    detail: `${task.id}\nExternal data only — not sent to the model.\n${task.notifications} notifications; ${task.dropped} older entries discarded.\n${task.error ?? task.stopReason ?? ''}\n${task.events.join('\n')}`,
    actions: activeMcpWatch(task) ? ['stop'] : [],
  };
}
