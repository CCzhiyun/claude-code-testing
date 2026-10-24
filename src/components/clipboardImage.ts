import { spawnSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { projectStateDir } from '../paths.js';

export interface ClipboardImage { path: string; mediaType: 'image/png'; data: string }

export async function captureClipboardImage(cwd: string): Promise<ClipboardImage> {
  const directory = join(projectStateDir(cwd), 'attachments');
  await mkdir(directory, { recursive: true });
  const path = join(directory, `clipboard-${randomUUID()}.png`);
  if (process.platform === 'win32') {
    const script = "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $i=[Windows.Forms.Clipboard]::GetImage(); if($null -eq $i){exit 2}; $i.Save($env:CCPT_CLIPBOARD_IMAGE_PATH,[Drawing.Imaging.ImageFormat]::Png); $i.Dispose()";
    const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', script], { env: { ...process.env, CCPT_CLIPBOARD_IMAGE_PATH: path }, windowsHide: true });
    if (result.status === 2) throw new Error('Clipboard does not contain an image');
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Clipboard image capture failed with code ${result.status ?? 'unknown'}`);
  } else if (process.platform === 'darwin') {
    const result = spawnSync('pngpaste', [path], { stdio: 'ignore' });
    if (result.error) throw new Error('Install pngpaste to paste clipboard images');
    if (result.status !== 0) throw new Error('Clipboard does not contain a PNG image');
  } else {
    const result = spawnSync('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], { encoding: 'buffer', maxBuffer: 12 * 1024 * 1024 });
    if (result.error) throw new Error('Install xclip to paste clipboard images');
    if (result.status !== 0 || !result.stdout?.length) throw new Error('Clipboard does not contain a PNG image');
    await writeFile(path, result.stdout, { mode: 0o600 });
  }
  const info = await stat(path);
  if (info.size > 10 * 1024 * 1024) throw new Error('Clipboard image exceeds 10 MB');
  return { path, mediaType: 'image/png', data: (await readFile(path)).toString('base64') };
}
