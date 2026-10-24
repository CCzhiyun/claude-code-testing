/** Read-only display projection. Never write redacted values back to settings. */
export function configForDisplay(value: unknown, additionalSecrets: readonly string[] = []): unknown {
  const knownSecrets = new Set<string>(additionalSecrets.filter(Boolean));
  for (const [name, secret] of Object.entries(process.env)) if (secret && secret.length >= 4 && /secret|token|password|credential|api.?key/i.test(name)) knownSecrets.add(secret);
  const discover = (item: unknown, key = ''): void => {
    if (typeof item === 'string' && (key === 'apiKeyEnv' || key === 'authTokenEnv') && process.env[item]) knownSecrets.add(process.env[item]!);
    if (item && typeof item === 'object') {
      if (key === 'headersFromEnvironment') for (const env of Object.values(item)) if (typeof env === 'string' && process.env[env]) knownSecrets.add(process.env[env]!);
      for (const [name, child] of Object.entries(item)) discover(child, name);
    }
  };
  discover(value);
  const walk = (item: unknown, key = ''): unknown => {
    if (key === 'env' && item && typeof item === 'object') return Object.fromEntries(Object.keys(item).map((name) => [name, '[redacted]']));
    if (!['apiKeyEnv', 'apiKeyHeader', 'apiKeyPrefix', 'authTokenEnv', 'headersFromEnvironment', 'mcpCredentialBackend'].includes(key) && /secret|password|credential|authorization|cookie|api.?key|token/i.test(key) && typeof item !== 'number') return '[redacted]';
    if (typeof item === 'string') {
      let text = item;
      for (const secret of knownSecrets) text = text.replaceAll(secret, '[redacted]');
      text = text.replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [redacted]');
      if (/^https?:\/\//i.test(text)) {
        try {
          const url = new URL(text);
          if (url.username || url.password) { url.username = 'redacted'; url.password = ''; }
          for (const name of [...url.searchParams.keys()]) if (name !== 'api-version') url.searchParams.set(name, '[redacted]');
          url.hash = ''; text = url.href;
        } catch { return '[invalid URL hidden]'; }
      }
      return text;
    }
    if (Array.isArray(item)) return item.map((child) => walk(child));
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, walk(child, name)]));
    return item;
  };
  return walk(value);
}
