export type ComponentTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted';
export type ComponentKind = 'text' | 'message' | 'permission' | 'agent' | 'task' | 'spinner' | 'select' | 'dialog' | 'prompt' | 'status' | 'mcp';

export interface ComponentAction { id: string; label: string; disabled?: boolean; tone?: ComponentTone }
export interface ComponentModel {
  id: string;
  kind: ComponentKind;
  title?: string;
  body?: string;
  tone?: ComponentTone;
  selected?: number;
  progress?: number;
  actions?: readonly ComponentAction[];
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface ComponentRenderer { kind: ComponentKind; render(model: ComponentModel, width: number): string[] }
