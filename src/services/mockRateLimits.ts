const scenarios = { normal: { 'x-ratelimit-status': 'allowed' }, warning: { 'x-ratelimit-status': 'warning', 'x-ratelimit-utilization': '0.9' }, rejected: { 'x-ratelimit-status': 'rejected', 'retry-after': '60' } } as const;
export type MockScenario = keyof typeof scenarios;
export const mockRateLimitHeaders = (scenario: MockScenario): Record<string, string> => ({ ...scenarios[scenario] });
