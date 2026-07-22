import { api } from './api';
import type { ApiResponse } from '@/types';

export interface PlatformMetrics {
  totalTenants: number;
  activeSubscriptions: number;
  monthlyRecurringRevenue: number;
  invoicesThisMonth: number;
}

export interface TenantCompanyItem {
  id: string;
  name: string;
  gstNumber: string;
  isActive: boolean;
  createdAt: string;
  owner: { name: string; email: string };
  subscription: {
    planName: string;
    status: string;
    endDate: string;
  };
  usage: {
    users: number;
    invoices: number;
  };
}

export async function getPlatformMetrics(): Promise<PlatformMetrics> {
  const { data } = await api.get<ApiResponse<PlatformMetrics>>('/admin/metrics');
  return data.data!;
}

export async function listAllCompanies(): Promise<TenantCompanyItem[]> {
  const { data } = await api.get<ApiResponse<TenantCompanyItem[]>>('/admin/companies');
  return data.data!;
}

export async function extendSubscription(companyId: string, days: number = 30) {
  const { data } = await api.post<ApiResponse<any>>(`/admin/companies/${companyId}/extend`, { days });
  return data.data!;
}

export async function toggleCompanyStatus(companyId: string) {
  const { data } = await api.post<ApiResponse<{ id: string; name: string; isActive: boolean }>>(
    `/admin/companies/${companyId}/toggle-status`,
    {}
  );
  return data.data!;
}
