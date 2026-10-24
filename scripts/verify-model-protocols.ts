// Explicit opt-in live smoke test. Never reads project files into a prompt or changes settings.
import { loadConfig } from '../src/config.js';
import { callModel } from '../src/model.js';
import { modelAuthHeaders, resolveModelEndpoint } from '../src/modelConnection.js';
import { ModelRequestError } from '../src/modelErrors.js';

if (!process.argv.includes('--live')) throw new Error('Use --live to authorize a small paid request per tested protocol');
const original = await loadConfig(process.cwd());
const endpoint = new URL(resolveModelEndpoint(original.model));
const protocols = process.argv.includes('--probe-glm-alternatives') ? ['messages', 'chat-completions', 'responses'] as const : [original.model.apiProtocol ?? (original.model.provider === 'anthropic' ? 'messages' : 'chat-completions')];
if (protocols.length > 1 && endpoint.origin !== 'https://open.bigmodel.cn') throw new Error('Alternate probes are restricted to the existing GLM origin; configure other gateways explicitly');
const headers = modelAuthHeaders(original.model);
const credential = headers.authorization?.replace(/^Bearer\s+/i, '') ?? headers['x-api-key'] ?? headers['api-key'];
if (credential) process.env.CCPT_PROTOCOL_PROBE_KEY = credential;
try {
  for (const protocol of protocols) {
    const config = structuredClone(original);
    config.model.maxOutputTokens = 2048; config.model.thinkingEnabled = false; config.model.fastMode = false;
    config.model.responsesStore = false; delete config.model.responsesTextFormat;
    config.network.timeoutMs = 30000;
    if (protocol !== 'messages' && protocols.length > 1) {
      config.model.apiProtocol = protocol; config.model.apiKeyEnv = 'CCPT_PROTOCOL_PROBE_KEY';
      config.model.apiKeyHeader = 'authorization'; config.model.apiKeyPrefix = 'Bearer '; config.model.headersFromEnvironment = {};
      config.model.endpointUrl = new URL(`/api/paas/v4/${protocol === 'responses' ? 'responses' : 'chat/completions'}`, endpoint.origin).href;
      config.model.completionTokenField = 'max_tokens';
    }
    const started = Date.now(); let deltas = 0;
    try {
      const result = await callModel(config, 'This is a connectivity test. Reply exactly CCPT_OK. Do not use tools.', [{ role: 'user', content: 'Hello 你好' }], [], { onTextDelta() { deltas++; } });
      console.log(JSON.stringify({ protocol, model: config.model.name, status: 'parsed', stopReason: result.stopReason, hasText: result.content.some(x => x.type === 'text' && x.text?.includes('CCPT_OK')), deltas, usage: result.usage, durationMs: Date.now() - started }));
    } catch (error) {
      console.log(JSON.stringify({ protocol, model: config.model.name, status: 'failed', httpStatus: error instanceof ModelRequestError ? error.status : undefined, code: error instanceof ModelRequestError ? error.code : undefined, errorType: error instanceof Error ? error.name : 'Error', durationMs: Date.now() - started }));
    }
  }
} finally { delete process.env.CCPT_PROTOCOL_PROBE_KEY; }
