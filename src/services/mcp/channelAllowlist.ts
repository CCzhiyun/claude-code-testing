export interface ChannelRule { server: string; channels: string[] }
export function isMcpChannelAllowed(server: string, channel: string, rules: ChannelRule[]): boolean { const rule = rules.find((item) => item.server === server || item.server === '*'); return Boolean(rule?.channels.includes(channel) || rule?.channels.includes('*')); }
