import type { ModelMessage } from '../../types.js';
import { messageText } from '../SessionMemory/sessionMemoryUtils.js';
export function suggestNextPrompt(messages: ModelMessage[]): string | undefined { const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant'); if (!lastAssistant) return undefined; const text = messageText(lastAssistant); if (/test|验证|check/i.test(text)) return '运行相关测试并检查是否还有失败。'; if (/implement|实现|修改|changed/i.test(text)) return '检查这次修改的差异，并补充回归测试。'; return '继续处理尚未完成的下一项，并说明验证结果。'; }
