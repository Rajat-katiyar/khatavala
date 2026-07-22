import { api } from './api';
import type { ApiResponse, HealthData } from '@/types';

export async function pingHealth(): Promise<HealthData> {
  const { data } = await api.get<ApiResponse<HealthData>>('/health');
  if (!data.data) throw new Error('No health data');
  return data.data;
}
