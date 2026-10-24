import type { PlatformConfig } from '../../types.js'; import { ApiClient } from './client.js';
export interface ApiBootstrap { version: string; capabilities: string[]; serverTime?: string }
export const fetchApiBootstrap = (baseUrl: string, network: PlatformConfig['network'], token?: string): Promise<ApiBootstrap> => new ApiClient(baseUrl, network, token).json('/bootstrap');
