import type { ContentBlock, ModelMessage, PlatformConfig, ToolDefinition } from './types.js';
import type { ModelUsage } from './tokenUsage.js';
import type { RetryNotice } from './modelRetry.js';
import type { ResponsesResponse } from './responsesProtocol.js';
import { callResponsesModel } from './responsesModel.js';
import { callLegacyModel, authorizeModelEndpoint } from './legacyModel.js';
import { modelAuthHeaders, resolveModelEndpoint, resolveModelProtocol } from './modelConnection.js';
import { withModelDiagnosticSecrets, modelBoundaryFailure } from './modelErrors.js';
import { executionSignal, assertExecutionBoundary } from './executionControl.js';
import { validateToolSchemas } from './toolSchema.js';
import { validateModelToolCalls } from './modelToolSafety.js';
import { chatReasoningFields } from './modelCapabilities.js';
import { withModelRetry } from './modelRetry.js';
import { withModelBudget } from './spending.js';
import { prepareModelCredential } from './protectedModelCredentials.js';
import { validateModelToolChoice, validateToolChoiceResult } from './modelToolChoice.js';
import {validateModelAudio} from './modelAudio.js';
import {recordModelError,modelErrorLogPath} from './modelErrorLog.js';
export type { ModelUsage } from './tokenUsage.js';
export { authorizeModelEndpoint } from './legacyModel.js';

/** Native response is authoritative; content is a backwards-compatible UI/tool projection. */
export interface ModelResponse { response?: ResponsesResponse; content: ContentBlock[]; stopReason?: string; usage?: ModelUsage; responses?: ModelMessage['responses']; costUsd?: number }
export interface ModelStreamHandlers { onRetry?(notice: RetryNotice): void; onTextDelta?(delta: string): void; onThinkingDelta?(delta: string): void }

/** All CLI/TUI/SDK/worker/summary queries share this Responses-first boundary. */
export async function callModel(config: PlatformConfig, system: string, messages: ModelMessage[], tools: ToolDefinition[], stream?: ModelStreamHandlers): Promise<ModelResponse> {
  await assertExecutionBoundary();
  validateToolSchemas(tools);
  authorizeModelEndpoint(config, resolveModelEndpoint(config.model));
  try { await prepareModelCredential(config.model); } catch(error) { throw modelBoundaryFailure(error,'credential'); }
  const protocol = resolveModelProtocol(config.model);
  validateModelAudio(config,protocol,messages);
  validateModelToolChoice(protocol, tools);
  if (protocol === 'chat-completions') chatReasoningFields(config.model, tools.length);
  let secrets:string[];
  try { secrets = Object.values(modelAuthHeaders(config.model)).flatMap((value) => [value, value.replace(/^(?:Bearer|Basic)\s+/i, '')]); } catch(error) {throw modelBoundaryFailure(error,'credential');}
  return withModelDiagnosticSecrets(secrets, async () => {try{return await withModelRetry(config, system, messages, tools, stream, async handlers => {
    // Retry-After/TPM waiting is not permission to reuse revoked authority.
    // Check outside transport classification and before reserving another request.
    await assertExecutionBoundary();
    return withModelBudget(config, async () => {
    let result:ModelResponse;
    try {result = protocol === 'responses' ? await callResponsesModel(config, system, messages, tools, handlers) : await callLegacyModel(config, system, messages, tools, handlers);}
    catch(error){throw modelBoundaryFailure(error,'transport',executionSignal()?.aborted===true);}
    validateModelToolCalls(result.content, result.stopReason);
    validateToolChoiceResult(result.content, tools);
    return result;
  });});}catch(error){
    // Log final failures, not each transient retry; logging cannot replace the original error.
    try{const id=await recordModelError(config,tools.length,error);if(id&&error instanceof Error){error.message+=`\nDiagnostic ${id}: ${modelErrorLogPath()} (ccpt doctor errors; Ctrl+O in TUI).`;if(error.stack)error.stack+=`\nDiagnostic ${id}: ${modelErrorLogPath()}`;}}catch{/* Original error remains authoritative if persistence fails. */}
    throw error;
  }});
}
