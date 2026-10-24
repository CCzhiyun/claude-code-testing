import type { PlatformConfig } from '../../types.js'; import { ApiClient } from './client.js';
export interface ReviewQuota { remaining: number; resetsAt?: string }
export const fetchReviewQuota = (baseUrl: string, token: string, network: PlatformConfig['network']): Promise<ReviewQuota> => new ApiClient(baseUrl, network, token).json('/api/review-quota');
