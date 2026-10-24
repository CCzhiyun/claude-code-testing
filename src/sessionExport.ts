import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import type { ModelMessage, PlatformConfig, SessionRecord } from './types.js';
import { fullSessionMessages } from './sessions.js';
import { protectPath } from './policy.js';

function portableMessage(message: ModelMessage): ModelMessage {
  if (typeof message.content === 'string') return message;
  return { ...message, content: message.content.filter((block) => block.type !== 'thinking').map((block) => block.type === 'image' ? { type: 'text', text: `[Image attachment omitted: ${block.media_type ?? 'image'}]` } : block) };
}

export function renderSessionExport(session: SessionRecord, format: 'markdown' | 'json'): string {
  const messages = fullSessionMessages(session).map(portableMessage);
  if (format === 'json') return JSON.stringify({ schemaVersion: 1, id: session.id, title: session.title, cwd: session.cwd, createdAt: session.createdAt, updatedAt: session.updatedAt, parentId: session.parentId, archivedMessageCount: session.archivedMessages?.length ?? 0, messages, omitted: ['reasoning', 'image payloads'] }, null, 2) + '\n';
  const transcript = messages.map((message) => {
    const content = typeof message.content === 'string' ? message.content : message.content.map((block) => {
      if (block.type === 'text') return block.text ?? '';
      if (block.type === 'tool_use') return `Tool: ${block.name} (${block.id})\n\n${JSON.stringify(block.input, null, 2)}`;
      return `Tool result: ${block.tool_use_id}${block.is_error ? ' [error]' : ''}\n\n${block.content ?? ''}`;
    }).join('\n\n');
    return `## ${message.role}\n\n${content}`;
  }).join('\n\n');
  return `# ${session.title}\n\nSession: ${session.id}\n\nFull conversation including ${session.archivedMessages?.length ?? 0} archived messages. Reasoning and image payloads omitted. Review for sensitive content before sharing.\n\n${transcript}\n`;
}

export async function exportSession(session: SessionRecord, path: string, cwd: string, config: PlatformConfig): Promise<string> {
  if (config.policy.mode === 'restricted') throw new Error('Session export writes are disabled in restricted mode');
  const target = protectPath(resolve(cwd, path), config);
  if (!['.md', '.json'].includes(extname(target).toLowerCase())) throw new Error('Export path must end in .md or .json');
  await mkdir(dirname(target), { recursive: true });
  protectPath(target, config);
  try {
    await writeFile(target, renderSessionExport(session, extname(target).toLowerCase() === '.json' ? 'json' : 'markdown'), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Export file already exists; choose a new path. Existing files are never overwritten.');
    throw error;
  }
  return target;
}
