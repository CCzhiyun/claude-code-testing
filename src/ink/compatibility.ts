export type InkCompatibilityFamily = 'components' | 'hooks' | 'events' | 'termio' | 'layout' | 'renderer';
export function classifyInkReference(path: string): InkCompatibilityFamily {
  if (/(^|\/)components\//i.test(path)) return 'components';
  if (/(^|\/)hooks\//i.test(path) || /use[A-Z]/.test(path)) return 'hooks';
  if (/(^|\/)events\//i.test(path) || /event|keypress|input/i.test(path)) return 'events';
  if (/(^|\/)termio\//i.test(path) || /terminal|stdin|stdout/i.test(path)) return 'termio';
  if (/(^|\/)layout\//i.test(path) || /measure|width|height/i.test(path)) return 'layout';
  return 'renderer';
}
