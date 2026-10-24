import type { ModelMessage } from '../types.js';

export type BridgeState = 'disabled' | 'starting' | 'connected' | 'degraded' | 'stopped' | 'failed';
export type BridgeEventKind = 'sdk_message' | 'permission_request' | 'permission_response' | 'interrupt' | 'status' | 'ack';

export interface BridgeEvent {
  id: string;
  sessionId: string;
  sequence: number;
  kind: BridgeEventKind;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface BridgeSessionPointer {
  version: 1;
  sessionId: string;
  state: BridgeState;
  serverOrigin: string;
  pid?: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastError?: string;
}

export interface BridgeMessagePayload { message: ModelMessage }
