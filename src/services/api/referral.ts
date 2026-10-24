import type { PlatformConfig } from '../../types.js'; import { ApiClient } from './client.js';
export interface ReferralStatus { eligible: boolean; code?: string; creditAmount?: number }
export const fetchReferralStatus = (baseUrl: string, token: string, network: PlatformConfig['network']): Promise<ReferralStatus> => new ApiClient(baseUrl, network, token).json('/api/referral');
