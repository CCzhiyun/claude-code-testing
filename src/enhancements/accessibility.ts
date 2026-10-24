export interface AccessibilityPreferences { reduceMotion: boolean; highContrast: boolean; colorVision: 'default' | 'deuteranopia' | 'protanopia' | 'tritanopia' | 'monochrome'; screenReader: boolean; unicode: boolean }
export interface AccessibilityAudit { passed: boolean; warnings: string[]; preferences: AccessibilityPreferences }

export function detectAccessibilityPreferences(environment: NodeJS.ProcessEnv = process.env): AccessibilityPreferences {
  const noColor = 'NO_COLOR' in environment || environment.TERM === 'dumb';
  return { reduceMotion: environment.CCPT_REDUCE_MOTION === '1', highContrast: environment.CCPT_HIGH_CONTRAST === '1', colorVision: noColor ? 'monochrome' : (environment.CCPT_COLOR_VISION as AccessibilityPreferences['colorVision'] | undefined) ?? 'default', screenReader: environment.CCPT_SCREEN_READER === '1', unicode: environment.CCPT_ASCII !== '1' };
}

export function auditTerminalAccessibility(input: { width: number; height: number; colorDepth: number; interactive: boolean }, preferences = detectAccessibilityPreferences()): AccessibilityAudit {
  const warnings: string[] = [];
  if (!input.interactive) warnings.push('Terminal input is not interactive; picker controls fall back to textual commands.');
  if (input.width < 40 || input.height < 10) warnings.push('Terminal viewport is too small for full-screen dialogs.');
  if (input.colorDepth < 4 && preferences.colorVision !== 'monochrome') warnings.push('Selected theme needs more terminal colors; use ansi or monochrome mode.');
  if (preferences.screenReader && !preferences.reduceMotion) warnings.push('Screen-reader mode should also enable reduced motion.');
  return { passed: warnings.length === 0, warnings, preferences };
}
