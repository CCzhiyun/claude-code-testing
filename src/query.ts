import { QueryEngine } from './QueryEngine.js';
import type { ModelMessage, PlatformConfig, ToolDefinition } from './types.js';
export function query(config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[]) { return new QueryEngine(config).query(system, messages, tools); }
