export type ThemeName = 'dark' | 'light' | 'dark-daltonized' | 'light-daltonized' | 'ansi' | 'none';
export interface TerminalPalette { accent: number; text: number; muted: number; success: number; warning: number; danger: number; border: number; selection: number }

const palettes: Record<Exclude<ThemeName, 'none'>, TerminalPalette> = {
  dark: { accent: 173, text: 252, muted: 245, success: 114, warning: 221, danger: 203, border: 240, selection: 238 },
  light: { accent: 130, text: 235, muted: 243, success: 28, warning: 136, danger: 160, border: 250, selection: 254 },
  'dark-daltonized': { accent: 81, text: 252, muted: 245, success: 39, warning: 221, danger: 213, border: 240, selection: 238 },
  'light-daltonized': { accent: 25, text: 235, muted: 243, success: 31, warning: 130, danger: 127, border: 250, selection: 254 },
  ansi: { accent: 6, text: 7, muted: 8, success: 2, warning: 3, danger: 1, border: 8, selection: 8 },
};

export function resolveTheme(value?: string, environment: NodeJS.ProcessEnv = process.env): ThemeName {
  if (environment.NO_COLOR !== undefined || environment.TERM === 'dumb') return 'none';
  if (value && ['dark', 'light', 'dark-daltonized', 'light-daltonized', 'ansi', 'none'].includes(value)) return value as ThemeName;
  return environment.COLORFGBG?.split(';').at(-1) && Number(environment.COLORFGBG.split(';').at(-1)) > 7 ? 'light' : 'dark';
}

export function themeSequence(role: keyof TerminalPalette, theme: ThemeName): string {
  if (theme === 'none') return '';
  return `\u001b[38;5;${palettes[theme][role]}m`;
}

export function listThemes(): ThemeName[] { return ['dark', 'light', 'dark-daltonized', 'light-daltonized', 'ansi', 'none']; }
