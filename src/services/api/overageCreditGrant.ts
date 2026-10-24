import type { PlatformConfig } from '../../types.js'; import { ApiClient } from './client.js';
export interface OverageCreditGrant { amount: number; currency: string; expiresAt?: string }
export const fetchOverageCreditGrant = (baseUrl: string, token: string, network: PlatformConfig['network']): Promise<OverageCreditGrant | null> => new ApiClient(baseUrl, network, token).json('/api/overage-credit-grant');
