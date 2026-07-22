import { api } from './api';
import { useAuthStore } from '@/store/authStore';
import type {
  ApiResponse,
  GSTRate,
  HSNSummaryRow,
  GSTR1Summary,
  GSTR3BSummary,
  GSTLiability,
} from '@/types';

export interface PeriodParams {
  month?: number;
  year?: number;
  from?: string;
  to?: string;
}

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export async function getHSNSummary(params: PeriodParams = {}): Promise<HSNSummaryRow[]> {
  const { data } = await api.get<ApiResponse<HSNSummaryRow[]>>('/gst/hsn-summary', {
    params,
  });
  return data.data ?? [];
}

export async function getGSTR1(params: PeriodParams = {}): Promise<GSTR1Summary> {
  const { data } = await api.get<ApiResponse<GSTR1Summary>>('/gst/gstr1', { params });
  return data.data!;
}

export async function getGSTR3B(params: PeriodParams = {}): Promise<GSTR3BSummary> {
  const { data } = await api.get<ApiResponse<GSTR3BSummary>>('/gst/gstr3b', { params });
  return data.data!;
}

export async function getGSTLiability(params: PeriodParams = {}): Promise<GSTLiability> {
  const { data } = await api.get<ApiResponse<GSTLiability>>('/gst/liability', { params });
  return data.data!;
}

export async function getEInvoiceJSON(invoiceId: string): Promise<unknown> {
  const { data } = await api.get<ApiResponse<unknown>>(`/gst/einvoice/${invoiceId}`);
  return data.data!;
}

/* ------------------------------------------------------------------ *
 * Exports
 * ------------------------------------------------------------------ */

type GSTExportKind = 'gstr1' | 'gstr3b' | 'hsn-summary';

export async function downloadGSTExport(
  kind: GSTExportKind,
  params: PeriodParams = {}
): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const baseURL = import.meta.env.VITE_API_URL ?? '/api';

  const search = new URLSearchParams();
  if (params.month) search.set('month', String(params.month));
  if (params.year) search.set('year', String(params.year));
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);

  const url = `${baseURL}/gst/${kind}/export?${search}`;
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error('Could not generate the export');

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `${kind.toUpperCase()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

/* ------------------------------------------------------------------ *
 * GST Rate master CRUD
 * ------------------------------------------------------------------ */

export async function getGSTRates(): Promise<GSTRate[]> {
  const { data } = await api.get<ApiResponse<GSTRate[]>>('/gst/rates');
  return data.data ?? [];
}

export async function createGSTRate(payload: {
  hsnCode: string;
  description?: string;
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
  cessPercent?: number;
}): Promise<GSTRate> {
  const { data } = await api.post<ApiResponse<GSTRate>>('/gst/rates', payload);
  return data.data!;
}

export async function updateGSTRate(
  id: string,
  payload: Partial<{
    description: string;
    cgstPercent: number;
    sgstPercent: number;
    igstPercent: number;
    cessPercent: number;
    isActive: boolean;
  }>
): Promise<GSTRate> {
  const { data } = await api.put<ApiResponse<GSTRate>>(`/gst/rates/${id}`, payload);
  return data.data!;
}

export async function deleteGSTRate(id: string): Promise<void> {
  await api.delete(`/gst/rates/${id}`);
}
