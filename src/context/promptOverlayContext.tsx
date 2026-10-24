import { OverlayContext } from './overlayContext.js';
export interface PromptOverlay { id: string; message: string; options: Array<{ key: string; label: string }> }
export class PromptOverlayContext extends OverlayContext<PromptOverlay> {}
