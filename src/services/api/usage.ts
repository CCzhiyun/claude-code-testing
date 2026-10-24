import type { PlatformConfig } from '../../types.js'; import { ApiClient } from './client.js';
export interface RateLimit { utilization: number | null; resets_at: string | null }
export interface Utilization { five_hour?: RateLimit | null; seven_day?: RateLimit | null; extra_usage?: { is_enabled: boolean; monthly_limit: number | null; used_credits: number | null; utilization: number | null } | null }
export const fetchUtilization = (baseUrl: string, token: string, network: PlatformConfig['network']): Promise<Utilization> => new ApiClient(baseUrl, network, token).json('/api/usage');
