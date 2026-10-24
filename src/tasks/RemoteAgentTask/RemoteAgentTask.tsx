import type { ModelMessage } from '../../types.js';
import { DirectConnectManager } from '../../server/directConnectManager.js';
import type { SessionInfo } from '../../server/types.js';
import type { SessionsWebSocketOptions } from '../../remote/SessionsWebSocket.js';
export class RemoteAgentTask { private manager?: DirectConnectManager; constructor(private readonly session: SessionInfo, private readonly options: SessionsWebSocketOptions = {}) {} start(onMessage?: (message: ModelMessage) => void | Promise<void>): DirectConnectManager { if (this.manager) throw new Error('Remote agent task is already running'); this.manager = new DirectConnectManager(this.session, { ...this.options, ...(onMessage ? { onSdkMessage: onMessage } : {}) }); this.manager.connect(); return this.manager; } interrupt(): void { this.manager?.interrupt(); } stop(): void { this.manager?.disconnect(); this.manager = undefined; } }
