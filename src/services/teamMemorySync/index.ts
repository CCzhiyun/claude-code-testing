import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { assertWithinRoots } from '../../paths.js';
import { assertTeamMemorySafe } from './teamMemSecretGuard.js';
import type { TeamMemoryChange } from './types.js';
export async function applyTeamMemoryChange(root: string, change: TeamMemoryChange): Promise<string> { assertTeamMemorySafe(change.content); const path = assertWithinRoots(resolve(root, change.path), [root]); await mkdir(dirname(path), { recursive: true }); await writeFile(path, change.content, { mode: 0o600 }); return path; }
