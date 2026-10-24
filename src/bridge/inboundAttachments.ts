import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { projectStateDir, resolveWorkspacePath } from '../paths.js';

export interface InboundAttachment {
  id: string;
  fileName: string;
  mediaType: string;
  contentBase64: string;
}

export async function saveInboundAttachment(
  cwd: string,
  messageId: string,
  value: InboundAttachment,
  options: { maxBytes: number; workspaceRoots: string[] },
): Promise<string> {
  if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(messageId) || !/^[a-zA-Z0-9_.:-]{1,200}$/.test(value.id)) throw new Error('Invalid attachment or message ID');
  const fileName = basename(value.fileName).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 200);
  if (!fileName || fileName === '.' || fileName === '..') throw new Error('Invalid attachment filename');
  if (!/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(value.mediaType)) throw new Error('Invalid attachment media type');
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(value.contentBase64) || value.contentBase64.length % 4 !== 0) throw new Error('Attachment content is not canonical base64');
  const content = Buffer.from(value.contentBase64, 'base64');
  if (content.byteLength > options.maxBytes) throw new Error('Attachment exceeds the configured size limit');
  const directory = resolveWorkspacePath(cwd, join(projectStateDir(cwd), 'remote-attachments', messageId), options.workspaceRoots);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = resolveWorkspacePath(cwd, join(directory, `${value.id}-${fileName}`), options.workspaceRoots);
  await writeFile(path, content, { flag: 'wx', mode: 0o600 });
  return path;
}
