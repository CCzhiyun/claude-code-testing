import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { homeStateDir } from '../paths.js';
import { readJson, writeJson } from '../storage.js';
import { audit } from '../audit.js';

export interface TrustedDevice {
  id: string;
  label: string;
  fingerprint: string;
  createdAt: string;
  lastSeenAt: string;
}

interface TrustedDeviceFile { version: 1; devices: TrustedDevice[] }

const devicePath = () => join(homeStateDir(), 'trusted-devices.json');
export const fingerprintDevice = (publicIdentity: string): string => createHash('sha256').update(publicIdentity, 'utf8').digest('base64url');

export async function trustDevice(label: string, publicIdentity: string): Promise<TrustedDevice> {
  if (!label.trim() || Buffer.byteLength(label) > 200) throw new Error('Trusted device label is invalid');
  const store = await readJson<TrustedDeviceFile>(devicePath(), { version: 1, devices: [] });
  const fingerprint = fingerprintDevice(publicIdentity);
  const existing = store.devices.find((device) => device.fingerprint === fingerprint);
  const now = new Date().toISOString();
  const device = existing ?? { id: randomUUID(), label: label.trim(), fingerprint, createdAt: now, lastSeenAt: now };
  device.label = label.trim(); device.lastSeenAt = now;
  if (!existing) store.devices.push(device);
  await writeJson(devicePath(), store);
  await audit({ event: 'TrustedDeviceAdd', outcome: 'success', details: { deviceId: device.id, fingerprint } });
  return structuredClone(device);
}

export async function isTrustedDevice(publicIdentity: string): Promise<boolean> {
  const store = await readJson<TrustedDeviceFile>(devicePath(), { version: 1, devices: [] });
  return store.devices.some((device) => device.fingerprint === fingerprintDevice(publicIdentity));
}

export async function revokeTrustedDevice(id: string): Promise<boolean> {
  const store = await readJson<TrustedDeviceFile>(devicePath(), { version: 1, devices: [] });
  const length = store.devices.length;
  store.devices = store.devices.filter((device) => device.id !== id);
  if (store.devices.length === length) return false;
  await writeJson(devicePath(), store);
  await audit({ event: 'TrustedDeviceRevoke', outcome: 'success', details: { deviceId: id } });
  return true;
}

export async function listTrustedDevices(): Promise<TrustedDevice[]> {
  return (await readJson<TrustedDeviceFile>(devicePath(), { version: 1, devices: [] })).devices.map((device) => structuredClone(device));
}
