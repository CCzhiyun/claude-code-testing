import { isMcpChannelAllowed, type ChannelRule } from './channelAllowlist.js';
export function assertMcpChannelPermission(server: string, channel: string, rules: ChannelRule[]): void { if (!isMcpChannelAllowed(server, channel, rules)) throw new Error(`MCP channel is not allowed: ${server}/${channel}`); }
