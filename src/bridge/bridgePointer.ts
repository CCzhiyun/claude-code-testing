import { join } from 'node:path';
import { projectStateDir } from '../paths.js';
import { readJson, writeJson } from '../storage.js';
import type { BridgeSessionPointer } from './types.js';

const pointerPath = (cwd: string) => join(projectStateDir(cwd), 'bridge-session.json');

export async function readBridgePointer(cwd: string): Promise<BridgeSessionPointer | undefined> {
  return readJson<BridgeSessionPointer | undefined>(pointerPath(cwd), undefined);
}

export async function writeBridgePointer(cwd: string, pointer: BridgeSessionPointer): Promise<void> {
  if (pointer.version !== 1 || !pointer.sessionId) throw new Error('Invalid bridge session pointer');
  await writeJson(pointerPath(cwd), pointer);
}

export async function updateBridgePointer(cwd: string, update: Partial<Omit<BridgeSessionPointer, 'version' | 'sessionId' | 'createdAt'>>): Promise<BridgeSessionPointer> {
  const pointer = await readBridgePointer(cwd);
  if (!pointer) throw new Error('No active bridge session pointer');
  const next = { ...pointer, ...update, version: 1 as const, sessionId: pointer.sessionId, createdAt: pointer.createdAt, updatedAt: new Date().toISOString() };
  await writeBridgePointer(cwd, next);
  return next;
}
