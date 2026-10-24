/** Value-taking flags shared by the executable and the public invocation parser. */
export const CLI_VALUE_OPTIONS = [
  'cwd', 'permission-mode', 'timeout', 'title', 'url', 'command', 'args', 'json', 'model', 'base-url', 'endpoint-url', 'api-key-header', 'api-key-prefix', 'max-context', 'allow-host', 'token-env', 'agent', 'oauth-client-id', 'oauth-token-url', 'oauth-device-url', 'oauth-scopes', 'server', 'query', 'line', 'character', 'max-chars', 'extensions', 'language-id', 'surface-manifest', 'scope',
  'api-preset', 'api-protocol', 'responses-transport', 'api-key-env', 'token-field', 'marketplace', 'ca-file', 'max-output', 'http-mode', 'responses-store', 'response-schema',
  'output-format', 'resume', 'append-system-prompt', 'append-system-prompt-file', 'settings', 'mcp-config', 'plugin-dir', 'tools', 'agents', 'budget-usd', 'max-requests', 'input-format',
  'key-file', 'key-id', 'max-events', 'max-reconnects', 'effort', 'max-budget-usd', 'flow', 'redirect-uri', 'oauth-issuer', 'oauth-authorization-url', 'oauth-metadata-url', 'agent-id', 'from-env', 'expected-version',
  'offset', 'limit', 'expected-commit', 'expected-digest', 'expected-sha256', 'ref', 'branch', 'kind', 'minutes', 'state-home',
  'agent-mode', 'max-tokens', 'max-runs',
  'at', 'prompt', 'job', 'cursor', 'objective', 'status', 'reason',
  'goal-id', 'plan-id', 'expected-plan-version', 'max-attempts', 'feedback', 'approve-request', 'text-limit', 'collector-file', 'day', 'anchor',
  'fixture','tokens','encoding','port','host',
] as const;
