import { api } from './api';
import { useAuthStore } from '@/store/authStore';
import type {
  ApiResponse,
  BalanceSheetReport,
  DayBookReport,
  DrillDownResult,
  ProfitAndLossReport,
  TrialBalanceReport,
} from '@/types';

export interface DateRange {
  from?: string;
  to?: string;
}

export async function getTrialBalance(range: DateRange = {}): Promise<TrialBalanceReport> {
  const { data } = await api.get<ApiResponse<TrialBalanceReport>>(
    '/reports/trial-balance',
    { params: range }
  );
  return data.data!;
}

export async function getProfitAndLoss(
  range: DateRange = {}
): Promise<ProfitAndLossReport> {
  const { data } = await api.get<ApiResponse<ProfitAndLossReport>>(
    '/reports/profit-loss',
    { params: range }
  );
  return data.data!;
}

export async function getBalanceSheet(asOf?: string): Promise<BalanceSheetReport> {
  const { data } = await api.get<ApiResponse<BalanceSheetReport>>(
    '/reports/balance-sheet',
    { params: asOf ? { to: asOf } : {} }
  );
  return data.data!;
}

export async function getDayBook(range: DateRange & { date?: string } = {}): Promise<DayBookReport> {
  const { data } = await api.get<ApiResponse<DayBookReport>>('/reports/day-book', {
    params: range,
  });
  return data.data!;
}

export async function getDrillDown(params: {
  accountId: string;
  from?: string | null;
  to?: string | null;
  page?: number;
}): Promise<DrillDownResult> {
  const { data } = await api.get<ApiResponse<DrillDownResult>>('/reports/drill-down', {
    params: {
      accountId: params.accountId,
      from: params.from ?? undefined,
      to: params.to ?? undefined,
      page: params.page,
    },
  });
  return data.data!;
}

export type ReportKind = 'trial-balance' | 'profit-loss' | 'balance-sheet' | 'day-book';

/**
 * Downloads a report export.
 *
 * fetch with an explicit Authorization header rather than `window.open`: the
 * endpoint is authenticated and a new tab carries no bearer token. Same
 * approach as the invoice PDF download.
 */
export async function downloadReport(
  kind: ReportKind,
  format: 'pdf' | 'xlsx',
  range: DateRange & { date?: string } = {}
): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const baseURL = import.meta.env.VITE_API_URL ?? '/api';

  const search = new URLSearchParams({ format });
  if (range.from) search.set('from', range.from);
  if (range.to) search.set('to', range.to);
  if (range.date) search.set('date', range.date);

  const response = await fetch(`${baseURL}/reports/${kind}/export?${search}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error('Could not generate the export');

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${kind}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next tick — revoking synchronously can cancel the download
  // before the browser has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
