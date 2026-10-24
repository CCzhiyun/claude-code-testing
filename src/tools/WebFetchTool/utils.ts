import type { PlatformConfig } from '../../types.js';
import { networkRequest } from '../../network.js';
import { isPreapprovedHost } from './preapproved.js';

export const MAX_MARKDOWN_LENGTH = 100_000;
export type FetchedContent = { url: string; markdown: string; status: number; contentType: string };
const cache = new Map<string, { expires: number; content: FetchedContent }>();

export function clearWebFetchCache(): void { cache.clear(); }
export function validateURL(value: string): boolean { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } }
export function isPreapprovedUrl(value: string): boolean { try { const url = new URL(value); return isPreapprovedHost(url.hostname, url.pathname); } catch { return false; } }
export async function checkDomainBlocklist(value: string): Promise<void> {
  const host = new URL(value).hostname.toLowerCase();
  if (host === '169.254.169.254' || host === 'metadata.google.internal' || /^(?:10|127|0)\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) throw new Error(`Blocked private or metadata host: ${host}`);
}
export function isPermittedRedirect(from: string, to: string): boolean { const source = new URL(from), target = new URL(to, source); return ['http:', 'https:'].includes(target.protocol) && !(source.protocol === 'https:' && target.protocol === 'http:'); }
export async function getWithPermittedRedirects(value: string, config: PlatformConfig['network']): Promise<{ status: number; text: string; url: string; contentType: string }> {
  let url = value;
  for (let index = 0; index < 5; index += 1) {
    const host = new URL(url).hostname.toLowerCase();
    if (!config.allowedHosts.some((entry) => entry.toLowerCase() === host)) await checkDomainBlocklist(url);
    const response = await networkRequest(url, { method: 'GET', headers: { accept: 'text/html,text/plain,application/json' } }, config);
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) { const next = new URL(location, url).href; if (!isPermittedRedirect(url, next)) throw new Error('Unsafe web redirect'); url = next; continue; }
    return { status: response.status, text: response.text, url, contentType: String(response.headers['content-type'] ?? '') };
  }
  throw new Error('Too many redirects');
}
export async function getURLMarkdownContent(value: string, config: PlatformConfig['network']): Promise<FetchedContent> {
  if (!validateURL(value)) throw new Error('Invalid web URL');
  const hit = cache.get(value); if (hit && hit.expires > Date.now()) return structuredClone(hit.content);
  const response = await getWithPermittedRedirects(value, config); let text = response.text;
  if (/html/i.test(response.contentType)) text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const content = { url: response.url, markdown: text.slice(0, MAX_MARKDOWN_LENGTH), status: response.status, contentType: response.contentType };
  cache.set(value, { expires: Date.now() + 5 * 60_000, content }); return structuredClone(content);
}
export async function applyPromptToMarkdown(markdown: string, prompt: string): Promise<string> { const query = prompt.toLowerCase().split(/\W+/).filter((word) => word.length > 3); const paragraphs = markdown.split(/\n{2,}|(?<=[.!?])\s+/); const selected = query.length ? paragraphs.filter((paragraph) => query.some((word) => paragraph.toLowerCase().includes(word))) : paragraphs; return (selected.length ? selected : paragraphs).join('\n').slice(0, MAX_MARKDOWN_LENGTH); }
