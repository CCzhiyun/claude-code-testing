import { resolve } from 'node:path';
export function stripEmptyLines(content: string): string { return content.split(/\r?\n/).filter((line) => line.trim()).join('\n'); }
export function isImageOutput(content: string): boolean { return /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(content.trim()); }
export function parseDataUri(content: string): { mimeType: string; data: Buffer } | null { const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(content.trim()); return match?.[1] && match[2] ? { mimeType: match[1].toLowerCase(), data: Buffer.from(match[2], 'base64') } : null; }
export function buildImageToolResult(content: string): { type: 'image'; mimeType: string; data: string } | null { const parsed = parseDataUri(content); return parsed ? { type: 'image', mimeType: parsed.mimeType, data: parsed.data.toString('base64') } : null; }
export async function resizeShellImageOutput(content: string): Promise<string> { return content; }
export function formatOutput(content: string): { content: string; truncated: boolean } { const limit = 100_000; return { content: content.length > limit ? `${content.slice(0, limit)}\n[truncated]` : content, truncated: content.length > limit }; }
export const stdErrAppendShellResetMessage = (stderr: string): string => stderr;
export function resetCwdIfOutsideProject(cwd: string, project: string): string { const absolute = resolve(cwd), root = resolve(project); return absolute === root || absolute.startsWith(`${root}\\`) || absolute.startsWith(`${root}/`) ? absolute : root; }
export function createContentSummary(content: Array<{ type?: string; text?: string }>): string { return content.map((item) => item.text ?? `[${item.type ?? 'content'}]`).join('\n').slice(0, 2_000); }
