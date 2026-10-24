export interface TextSelection { start: number; end: number }
export interface TextInputState { value: string; cursor: number; selection?: TextSelection }

export function normalizeTextInput(state: TextInputState): TextInputState {
  const cursor = Math.max(0, Math.min(state.value.length, Math.trunc(state.cursor)));
  if (!state.selection) return { value: state.value, cursor };
  const start = Math.max(0, Math.min(state.value.length, Math.trunc(state.selection.start)));
  const end = Math.max(start, Math.min(state.value.length, Math.trunc(state.selection.end)));
  return { value: state.value, cursor, selection: { start, end } };
}
