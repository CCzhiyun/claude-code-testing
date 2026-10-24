import { terminalWidth } from '../ink.js';
import { truncateTerminal, tuiTheme } from '../tui/presentation.js';

export type LogoVariant = 'full' | 'condensed' | 'mark';
export interface BrandNotice { id: string; text: string; priority: number; expiresAt?: number }

export function logoVariant(width: number): LogoVariant { return width >= 72 ? 'full' : width >= 38 ? 'condensed' : 'mark'; }

export function renderBrandLogo(width: number, subtitle = 'Agentic coding, in your terminal'): string[] {
  const variant = logoVariant(width);
  const mark = `${tuiTheme.accent}✦${tuiTheme.reset}`;
  if (variant === 'mark') return [mark];
  if (variant === 'condensed') return [`${mark} ${tuiTheme.bold}CCPT${tuiTheme.reset}`];
  return [`${mark} ${tuiTheme.bold}CCPT${tuiTheme.reset}  ${tuiTheme.muted}${truncateTerminal(subtitle, Math.max(1, width - 10))}${tuiTheme.reset}`];
}

export class BrandingFeed {
  #index = 0;
  constructor(private readonly notices: readonly BrandNotice[], private readonly reduceMotion = false) {}
  visible(now = Date.now()): BrandNotice[] { return this.notices.filter((notice) => !notice.expiresAt || notice.expiresAt > now).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)); }
  current(now = Date.now()): BrandNotice | undefined { const visible = this.visible(now); if (!visible.length) return undefined; this.#index %= visible.length; return visible[this.#index]; }
  advance(now = Date.now()): BrandNotice | undefined { const visible = this.visible(now); if (!visible.length) return undefined; if (!this.reduceMotion) this.#index = (this.#index + 1) % visible.length; return visible[this.#index]; }
}

export function renderBrandNotice(notice: BrandNotice | undefined, width: number): string {
  if (!notice) return '';
  const prefix = notice.priority >= 90 ? `${tuiTheme.warning}!${tuiTheme.reset}` : `${tuiTheme.accent}●${tuiTheme.reset}`;
  const text = truncateTerminal(notice.text, Math.max(1, width - 2));
  return `${prefix} ${text}${' '.repeat(Math.max(0, width - 2 - terminalWidth(text)))}`;
}
