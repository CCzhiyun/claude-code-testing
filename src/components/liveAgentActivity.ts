import type { AgentStreamState } from '../types.js';
import { renderTranscriptEntry, tuiTheme } from '../tui/presentation.js';
import { estimateTokens } from '../tokenUsage.js';

export function renderLiveAgentActivity(stream: AgentStreamState, width: number, spinner: string, now = Date.now(), taskLines: readonly string[] = []): string[] {
  const elapsed = Math.max(0, Math.floor((now - Date.parse(stream.startedAt)) / 1_000));
  const tokenCount = stream.outputTokens ?? estimateTokens(stream.text + (stream.thinking ?? ''));
  const approximate = stream.outputTokens === undefined || stream.outputTokenSource === 'estimated';
  const tokens = tokenCount >= 1_000 ? `${(tokenCount / 1_000).toFixed(1).replace(/\.0$/, '')}k` : String(tokenCount);
  const tool = stream.activeTool?.name ? stream.activeTool.name.replaceAll('_', ' ') : 'tool';
  const label = stream.phase === 'thinking' ? 'Thinking'
    : stream.phase === 'responding' ? 'Streaming response'
    : stream.phase === 'tool' ? `Running ${tool}`
    : 'Processing tool results';
  const lines = stream.text ? [...renderTranscriptEntry({ role: 'assistant', text: stream.text }, width), ''] : [];
  lines.push(`${tuiTheme.accent}  ${spinner} ${label}…${tuiTheme.reset} ${tuiTheme.muted}(${elapsed}s · ↑ ${approximate ? '~' : ''}${tokens} tokens${approximate ? ' estimated' : ''} · ${stream.phase})${tuiTheme.reset}`);
  if (taskLines.length) lines.push(...taskLines.map((line) => `${tuiTheme.muted}${line}${tuiTheme.reset}`));
  lines.push('');
  return lines;
}
