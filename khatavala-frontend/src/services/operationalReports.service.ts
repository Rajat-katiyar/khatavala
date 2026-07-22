import { api } from './api';
import { useAuthStore } from '@/store/authStore';
import type { ApiResponse } from '@/types';

export interface ReportParams {
  from?: string;
  to?: string;
  customerId?: string;
  supplierId?: string;
  productId?: string;
  search?: string;
  type?: 'customer' | 'supplier';
}

export async function getSalesReport(params: ReportParams) {
  const { data } = await api.get<ApiResponse<{ rows: any[]; summary: any }>>('/reports/op/sales', { params });
  return data.data!;
}

export async function getPurchaseReport(params: ReportParams) {
  const { data } = await api.get<ApiResponse<{ rows: any[]; summary: any }>>('/reports/op/purchases', { params });
  return data.data!;
}

export async function getInventoryValuationReport() {
  const { data } = await api.get<ApiResponse<{ items: any[]; summary: any }>>('/reports/op/inventory-valuation');
  return data.data!;
}

export async function getStockMovementReport(params: ReportParams) {
  const { data } = await api.get<ApiResponse<{ items: any[] }>>('/reports/op/stock-movement', { params });
  return data.data!;
}

export async function getOutstandingAgingReport(type: 'customer' | 'supplier' = 'customer') {
  const { data } = await api.get<ApiResponse<{ rows: any[]; summary: any }>>('/reports/op/aging', {
    params: { type },
  });
  return data.data!;
}

export async function getProductPerformanceReport(params: ReportParams) {
  const { data } = await api.get<ApiResponse<{ topSellers: any[]; slowMovers: any[] }>>(
    '/reports/op/product-performance',
    { params }
  );
  return data.data!;
}

export async function downloadReportExcel(type: string, partyKind?: string) {
  const token = useAuthStore.getState().accessToken;
  const baseURL = import.meta.env.VITE_API_URL ?? '/api';

  const query = new URLSearchParams({ type });
  if (partyKind) query.append('partyKind', partyKind);

  const response = await fetch(`${baseURL}/reports/op/export-excel?${query.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  if (!response.ok) throw new Error('Excel download failed');

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${type}_report.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
