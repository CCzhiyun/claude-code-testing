let suppressed = false; let lastWarningAt = 0;
export function suppressCompactWarning(): void { suppressed = true; }
export function clearCompactWarningSuppression(): void { suppressed = false; }
export function shouldShowCompactWarning(now = Date.now(), cooldownMs = 60_000): boolean { if (suppressed || now - lastWarningAt < cooldownMs) return false; lastWarningAt = now; return true; }
export function resetCompactWarningState(): void { suppressed = false; lastWarningAt = 0; }
