import { cancelAgent, listAgents, loadAgent, waitForAgent } from '../../agent.js';
export async function handleAgents(action?: string, id?: string): Promise<unknown> { if (!action) return listAgents(); if (!id) return loadAgent(action); if (action === 'wait') return waitForAgent(id); if (action === 'cancel') return cancelAgent(id); throw new Error('Unsupported agents action'); }
