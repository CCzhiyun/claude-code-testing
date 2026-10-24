import type { AgentStatus } from '../types.js';
import type { CompanionMood, CompanionState } from './types.js';
const moodForStatus = (status: AgentStatus): CompanionMood => status === 'working' || status === 'queued' ? 'working' : status === 'completed' ? 'celebrating' : status === 'failed' || status === 'waiting_for_input' ? 'concerned' : status === 'cancelled' ? 'sleeping' : 'idle';
export class Companion { private current: CompanionState = { mood: 'idle', updatedAt: new Date().toISOString() }; updateAgent(status: AgentStatus, message?: string): CompanionState { this.current = { mood: moodForStatus(status), ...(message ? { message: message.slice(0, 240) } : {}), updatedAt: new Date().toISOString() }; return this.state; } get state(): CompanionState { return { ...this.current }; } }
