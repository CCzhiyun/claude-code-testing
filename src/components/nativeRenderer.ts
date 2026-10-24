import { truncateTerminal } from '../ink.js';
import { symbols, tone } from './designSystem.js';
import { ComponentRegistry } from './registry.js';
import type { ComponentKind, ComponentModel, ComponentRenderer } from './types.js';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const safeWidth = (width: number): number => Math.max(4, Math.floor(width));

function lines(model: ComponentModel, width: number): string[] {
  const output: string[] = [];
  const prefix = model.kind === 'spinner' ? `${frames[Number(model.metadata?.frame ?? 0) % frames.length]} ` : model.kind === 'permission' ? `${symbols.warning} ` : '';
  if (model.title) output.push(tone(truncateTerminal(`${prefix}${model.title}`, safeWidth(width)), model.tone));
  if (model.body) for (const line of model.body.split(/\r?\n/)) output.push(truncateTerminal(line, safeWidth(width)));
  if (model.progress !== undefined) {
    const cells = Math.max(1, Math.min(20, safeWidth(width) - 8)); const filled = Math.round(cells * Math.max(0, Math.min(1, model.progress)));
    output.push(`[${'='.repeat(filled)}${' '.repeat(cells - filled)}] ${Math.round(model.progress * 100)}%`);
  }
  model.actions?.forEach((action, index) => output.push(`${index === model.selected ? symbols.selected : ' '} ${tone(action.label, action.disabled ? 'muted' : action.tone)}`));
  return output.length ? output : [''];
}

class NativeRenderer implements ComponentRenderer {
  constructor(readonly kind: ComponentKind) {}
  render(model: ComponentModel, width: number): string[] { if (model.kind !== this.kind) throw new Error(`Renderer ${this.kind} cannot render ${model.kind}`); return lines(model, width); }
}

export function createNativeComponentRegistry(): ComponentRegistry {
  const registry = new ComponentRegistry();
  for (const kind of ['text', 'message', 'permission', 'agent', 'task', 'spinner', 'select', 'dialog', 'prompt', 'status', 'mcp'] as const) registry.register(new NativeRenderer(kind));
  return registry;
}

export function renderComponent(model: ComponentModel, width: number, registry = createNativeComponentRegistry()): string[] {
  const renderer = registry.get(model.kind);
  if (!renderer) throw new Error(`No renderer registered for ${model.kind}`);
  return renderer.render(model, width);
}
