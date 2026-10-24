import { join } from 'node:path';
import { projectStateDir } from './paths.js';
import { readJson, writeJson } from './storage.js';
export interface ProjectOnboardingState { version: 1; completed: boolean; completedAt?: string; dismissedSteps: string[] }
export async function readProjectOnboardingState(cwd: string): Promise<ProjectOnboardingState> { return readJson(join(projectStateDir(cwd), 'onboarding.json'), { version: 1, completed: false, dismissedSteps: [] }); }
export async function completeProjectOnboarding(cwd: string): Promise<ProjectOnboardingState> { const state: ProjectOnboardingState = { version: 1, completed: true, completedAt: new Date().toISOString(), dismissedSteps: [] }; await writeJson(join(projectStateDir(cwd), 'onboarding.json'), state); return state; }
