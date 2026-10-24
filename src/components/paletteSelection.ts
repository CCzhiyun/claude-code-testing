export interface PaletteSelection {
  name: string;
  kind?: 'command' | 'file' | 'history' | 'checkpoint' | 'model';
}

/**
 * Enter executes the highlighted slash command immediately. Tab remains the
 * completion-only key and is handled separately by the TUI.
 */
export function commandSubmissionForEnter(input: string, selected: PaletteSelection | undefined): string | undefined {
  if (selected?.kind !== 'command' || !input.startsWith('/') || input.includes(' ')) return undefined;
  return selected.name;
}
