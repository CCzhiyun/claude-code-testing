import type { PlatformConfig } from './types.js';

/** Applied equally to JSON and streaming Chat requests. Never removes tools. */
export function chatReasoningFields(model: PlatformConfig['model'], toolCount: number): Record<string, string> {
  if (toolCount > 0) {
    switch (model.chatToolReasoning ?? 'preserve') {
      case 'none': return { reasoning_effort: 'none' };
      case 'omit': return {};
      case 'responses-only': throw new Error('This deployment requires Responses for tools. Select its separate Responses settings/endpoint, or use an administrator-approved Chat deployment with chatToolReasoning=none. No request was sent.');
    }
  }
  return model.thinkingEnabled ? { reasoning_effort: model.reasoningEffort } : {};
}
