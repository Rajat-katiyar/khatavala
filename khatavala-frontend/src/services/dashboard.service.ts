import { api } from './api';
import type { ApiResponse } from '@/types';

export interface DashboardMetricsPayload {
  kpis: {
    totalSales: number;
    totalPurchases: number;
    cashCollected: number;
    outstandingReceivables: number;
    outstandingPayables: number;
    totalExpenses: number;
    netProfit: number;
  };
  salesTrend: Array<{ date: string; sales: number; purchases: number }>;
  topProducts: Array<{ id: string; name: string; sku: string; quantity: number; revenue: number }>;
  topCustomers: Array<{ id: string; name: string; revenue: number }>;
  paymentModeSplit: Array<{ mode: string; amount: number; count: number }>;
  lowStockAlerts: {
    count: number;
    items: Array<{ id: string; name: string; sku: string; stockQuantity: number; minStockLevel: number }>;
  };
  gstLiability: {
    outwardTax: number;
    itcAvailable: number;
    netPayable: number;
  };
}

export interface DashboardQueryParams {
  range?: 'today' | 'week' | 'month' | 'year' | 'custom';
  from?: string;
  to?: string;
}

export async function getDashboardMetrics(
  params: DashboardQueryParams = {}
): Promise<DashboardMetricsPayload> {
  const { data } = await api.get<ApiResponse<DashboardMetricsPayload>>('/dashboard', {
    params,
  });
  return data.data!;
}
