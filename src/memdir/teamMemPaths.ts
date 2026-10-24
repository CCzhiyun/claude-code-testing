import { join } from 'node:path';
import { homeStateDir } from '../paths.js';
export function teamMemoryDirectory(teamSessionId: string): string { if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(teamSessionId)) throw new Error('Invalid team session ID'); return join(homeStateDir(), 'team-memory', teamSessionId); }
