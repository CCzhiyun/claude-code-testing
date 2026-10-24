export function authStatus(environmentName = 'CCPT_API_KEY'): { configured: boolean; source: string } { return { configured: Boolean(process.env[environmentName]), source: environmentName }; }
