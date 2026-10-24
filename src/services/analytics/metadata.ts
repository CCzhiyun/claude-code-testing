import { extname } from 'node:path';
import type { AnalyticsMetadata } from './index.js';

export type EnvContext = { platform: NodeJS.Platform; arch: string; nodeVersion: string; ci: boolean };
export type ProcessMetrics = { uptimeSeconds: number; memoryRssBytes: number };
export type EventMetadata = AnalyticsMetadata & { platform: string; arch: string; node_version: string };

export function sanitizeToolNameForAnalytics(toolName: string): string {
  if (toolName.startsWith('mcp__')) return 'mcp';
  return toolName.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 100);
}

export function isToolDetailsLoggingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CCPT_ANALYTICS_TOOL_DETAILS === '1';
}

export function isAnalyticsToolDetailsLoggingEnabled(toolName: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return isToolDetailsLoggingEnabled(env) && !/write|edit|bash|shell/i.test(toolName);
}

export function extractMcpToolDetails(toolName: string): { serverName: string; toolName: string } | null {
  const match = /^mcp__([^_]+)__(.+)$/.exec(toolName);
  return match ? { serverName: match[1]!, toolName: match[2]! } : null;
}

export function mcpToolDetailsForAnalytics(toolName: string): AnalyticsMetadata {
  const details = extractMcpToolDetails(toolName);
  return details ? { mcp_server: details.serverName, mcp_tool: details.toolName } : {};
}

export function extractSkillName(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const value = (input as Record<string, unknown>).skill;
  return typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : null;
}

export function extractToolInputForTelemetry(toolName: string, input: unknown): AnalyticsMetadata {
  if (!isAnalyticsToolDetailsLoggingEnabled(toolName) || !input || typeof input !== 'object') return {};
  const value = input as Record<string, unknown>;
  return { has_input: Object.keys(value).length > 0, ...(typeof value.language === 'string' ? { language: value.language.slice(0, 40) } : {}) };
}

export function getFileExtensionForAnalytics(path: string): string {
  const extension = extname(path).toLowerCase();
  return /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : 'other';
}

export function getFileExtensionsFromBashCommand(command: string): string[] {
  const matches = command.match(/[\w./\\-]+\.[a-zA-Z0-9]{1,12}/g) ?? [];
  return [...new Set(matches.map(getFileExtensionForAnalytics))].slice(0, 20);
}

export async function getEventMetadata(metadata: AnalyticsMetadata = {}): Promise<EventMetadata> {
  return { ...metadata, platform: process.platform, arch: process.arch, node_version: process.versions.node };
}

export function to1PEventFormat(eventName: string, metadata: EventMetadata): { event: string; timestamp: string; metadata: EventMetadata } {
  return { event: eventName, timestamp: new Date().toISOString(), metadata };
}
