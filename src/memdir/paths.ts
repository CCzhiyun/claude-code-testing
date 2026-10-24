import { join } from 'node:path';
import { homeStateDir, projectStateDir } from '../paths.js';
export const userMemoryDirectory = () => join(homeStateDir(), 'memory');
export const projectMemoryDirectory = (cwd: string) => join(projectStateDir(cwd), 'memory');
export const memoryFilePath = (directory: string, id: string) => { if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(id)) throw new Error('Invalid memory ID'); return join(directory, `${id}.md`); };
export const isExtractModeActive = (): boolean => ['1', 'true', 'yes'].includes((process.env.CCPT_EXTRACT_MEMORIES ?? '').toLowerCase());
