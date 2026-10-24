import type { ComponentAction, ComponentModel, ComponentTone } from './types.js';

export const messageModel = (id: string, role: 'user' | 'assistant' | 'system' | 'error', body: string): ComponentModel => ({ id, kind: 'message', body, tone: role === 'error' ? 'danger' : role === 'assistant' ? 'success' : role === 'system' ? 'muted' : 'info', metadata: { role } });

export const permissionModel = (id: string, title: string, reason: string, actions: readonly ComponentAction[] = [{ id: 'allow-once', label: 'Allow once', tone: 'success' }, { id: 'deny', label: 'Deny', tone: 'danger' }]): ComponentModel => ({ id, kind: 'permission', title, body: reason, tone: 'warning', selected: 0, actions });

export const agentModel = (id: string, name: string, status: string, detail = ''): ComponentModel => ({ id, kind: 'agent', title: name, body: detail, tone: status === 'completed' ? 'success' : status === 'failed' ? 'danger' : 'info', metadata: { status } });

export const taskModel = (id: string, title: string, status: string, progress?: number): ComponentModel => ({ id, kind: 'task', title, tone: status === 'completed' ? 'success' : status === 'failed' ? 'danger' : 'neutral', ...(progress === undefined ? {} : { progress }), metadata: { status } });

export const selectModel = (id: string, title: string, actions: readonly ComponentAction[], selected = 0): ComponentModel => ({ id, kind: 'select', title, actions, selected: Math.max(0, Math.min(selected, Math.max(0, actions.length - 1))) });

export const spinnerModel = (id: string, title: string, frame: number): ComponentModel => ({ id, kind: 'spinner', title, tone: 'info', metadata: { frame } });

export function statusTone(status: string): ComponentTone { return status === 'completed' ? 'success' : status === 'failed' || status === 'cancelled' ? 'danger' : status === 'waiting_for_input' ? 'warning' : 'info'; }
