import { Companion } from './companion.js';
import type { AgentStatus } from '../types.js';
export function createBuddyNotification(companion = new Companion()) { return (status: AgentStatus, message?: string) => companion.updateAgent(status, message); }
