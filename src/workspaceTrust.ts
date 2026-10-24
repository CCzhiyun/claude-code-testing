import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { CURRENT_SETTINGS_VERSION } from './migrations/index.js';
import { homeStateDir, projectStateDir } from './paths.js';
import { readJson, withFileLock, writeJson } from './storage.js';

interface WorkspaceTrustEntry {
  trustedAt: string;
}

interface WorkspaceTrustStore {
  version: 1;
  workspaces: Record<string, WorkspaceTrustEntry>;
}

const emptyTrustStore = (): WorkspaceTrustStore => ({ version: 1, workspaces: {} });

export const userSettingsTemplate = {
  settingsVersion: CURRENT_SETTINGS_VERSION,
  env: {},
  permissions: { allow: [] as string[], deny: [] as string[] },
  autoUpdates: false,
  DISABLE_UPDATES: 1,
  shell: 'powershell',
};

export const userClaudeInstructionsTemplate = `# User Instructions

Add personal instructions that should apply to every CCPT workspace.
Keep credentials in settings.json or environment variables, never in this file.
`;

export const projectClaudeInstructionsTemplate = `# Project Instructions

Describe this repository's architecture, commands, conventions, constraints, and verification workflow for CCPT.
`;

export function workspaceTrustKey(cwd: string): string {
  const absolute = resolve(cwd).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

export function userSettingsPath(): string {
  return join(homeStateDir(), 'settings.json');
}

/** User instructions always live beside the user settings file. */
export function userClaudeInstructionsPath(): string {
  return join(dirname(userSettingsPath()), 'CLAUDE.md');
}

export function projectSettingsPath(cwd: string): string {
  return join(projectStateDir(cwd), 'settings.json');
}

function trustStorePath(): string {
  return join(homeStateDir(), 'workspace-trust.json');
}

async function writeIfMissing(path: string, value: unknown): Promise<void> {
  if (existsSync(path)) return;
  await withFileLock(`${path}.init.lock`, async () => {
    if (!existsSync(path)) await writeJson(path, value);
  });
}

async function writeTextIfMissing(path: string, value: string): Promise<void> {
  if (existsSync(path)) return;
  await withFileLock(`${path}.init.lock`, async () => {
    if (!existsSync(path)) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    }
  });
}

/** Create the user settings file without replacing any existing preferences. */
export async function ensureUserSettings(): Promise<string> {
  const path = userSettingsPath();
  // Bootstrap is not migration: never inject a developer's endpoint or aliases,
  // nor add defaults to a company-managed/user-provided settings file.
  await writeIfMissing(path, userSettingsTemplate);
  return path;
}

export async function ensureUserClaudeInstructions(): Promise<string> {
  const path = userClaudeInstructionsPath();
  await writeTextIfMissing(path, userClaudeInstructionsTemplate);
  return path;
}

/** Create the workspace settings file after trust is granted. */
export async function ensureProjectSettings(cwd: string): Promise<string> {
  const path = projectSettingsPath(cwd);
  await writeIfMissing(path, {
    settingsVersion: CURRENT_SETTINGS_VERSION,
    policy: { workspaceRoots: [resolve(cwd)] },
  });
  return path;
}

export async function ensureProjectClaudeInstructions(cwd: string): Promise<string> {
  const path = join(resolve(cwd), 'CLAUDE.md');
  await writeTextIfMissing(path, projectClaudeInstructionsTemplate);
  return path;
}

export async function isWorkspaceTrusted(cwd: string): Promise<boolean> {
  const store = await readJson<WorkspaceTrustStore>(trustStorePath(), emptyTrustStore());
  return Boolean(store.workspaces?.[workspaceTrustKey(cwd)]);
}

export async function trustWorkspace(cwd: string): Promise<void> {
  const path = trustStorePath();
  await withFileLock(`${path}.lock`, async () => {
    const store = await readJson<WorkspaceTrustStore>(path, emptyTrustStore());
    await writeJson(path, {
      version: 1,
      workspaces: {
        ...(store.workspaces ?? {}),
        [workspaceTrustKey(cwd)]: { trustedAt: new Date().toISOString() },
      },
    } satisfies WorkspaceTrustStore);
  });
}

export async function revokeWorkspaceTrust(cwd: string): Promise<void> {
  const path = trustStorePath();
  await withFileLock(`${path}.lock`, async () => {
    const store = await readJson<WorkspaceTrustStore>(path, emptyTrustStore());
    const workspaces = { ...(store.workspaces ?? {}) };
    delete workspaces[workspaceTrustKey(cwd)];
    await writeJson(path, { version: 1, workspaces } satisfies WorkspaceTrustStore);
  });
}
