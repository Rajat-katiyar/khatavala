import { api } from './api';
import type {
  ApiResponse,
  ImportResult,
  PayablesSummary,
  PaymentReminders,
  Supplier,
  SupplierLedger,
  SupplierPage,
} from '@/types';

// No companyId is sent from the client: the backend derives it from the
// access token's tenant claim. See khatavala-backend/docs/TENANCY.md.

export interface ListSuppliersParams {
  search?: string;
  sortBy?: 'name' | 'phone' | 'currentBalance' | 'vendorRating' | 'createdAt';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  isActive?: boolean;
  hasDues?: boolean;
  minRating?: number;
}

export async function listSuppliers(params: ListSuppliersParams = {}): Promise<SupplierPage> {
  const { data } = await api.get<ApiResponse<SupplierPage>>('/suppliers', { params });
  return data.data!;
}

export async function getSupplier(id: string): Promise<Supplier> {
  const { data } = await api.get<ApiResponse<{ supplier: Supplier }>>(`/suppliers/${id}`);
  return data.data!.supplier;
}

export interface SupplierInput {
  name: string;
  phone: string;
  email?: string;
  gstNumber?: string;
  pan?: string;
  address?: Supplier['address'];
  vendorRating?: number | null;
  /** Accepted on create only — the update endpoint rejects it. */
  openingBalance?: number;
  isActive?: boolean;
}

export async function createSupplier(input: SupplierInput): Promise<Supplier> {
  const { data } = await api.post<ApiResponse<{ supplier: Supplier }>>('/suppliers', input);
  return data.data!.supplier;
}

export async function updateSupplier(
  id: string,
  input: Partial<Omit<SupplierInput, 'openingBalance'>>
): Promise<Supplier> {
  const { data } = await api.patch<ApiResponse<{ supplier: Supplier }>>(
    `/suppliers/${id}`,
    input
  );
  return data.data!.supplier;
}

/** Hard-deletes a supplier with no ledger history; deactivates one that has it. */
export async function deleteSupplier(
  id: string
): Promise<{ deleted: boolean; deactivated: boolean }> {
  const { data } = await api.delete<ApiResponse<{ deleted: boolean; deactivated: boolean }>>(
    `/suppliers/${id}`
  );
  return data.data!;
}

export async function getLedger(
  id: string,
  params: { from?: string; to?: string; page?: number; limit?: number } = {}
): Promise<SupplierLedger> {
  const { data } = await api.get<ApiResponse<SupplierLedger>>(`/suppliers/${id}/ledger`, {
    params,
  });
  return data.data!;
}

export async function getOutstandingPayables(): Promise<PayablesSummary> {
  const { data } = await api.get<ApiResponse<PayablesSummary>>('/suppliers/outstanding');
  return data.data!;
}

export async function getPaymentReminders(id: string): Promise<PaymentReminders> {
  const { data } = await api.get<ApiResponse<PaymentReminders>>(`/suppliers/${id}/reminders`);
  return data.data!;
}

/**
 * Downloads the import template and hands it to the browser as a file.
 *
 * `responseType: 'blob'` matters — the default string transform would corrupt
 * the binary .xlsx, and the saved file would fail to open in Excel.
 */
export async function downloadTemplate(): Promise<void> {
  const { data } = await api.get('/suppliers/import/template', { responseType: 'blob' });
  const url = URL.createObjectURL(data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'khatavala-supplier-import-template.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function importSuppliers(file: File, dryRun = false): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);

  const { data } = await api.post<ApiResponse<ImportResult>>('/suppliers/import', form, {
    params: { dryRun },
    // Undefined, not 'multipart/form-data': the browser has to set this header
    // itself so it can append the multipart boundary. Hard-coding it produces a
    // body the server cannot parse. (Verified against axios 1.18.)
    headers: { 'Content-Type': undefined },
    // A 422 (every row failed) still carries a usable report, so let it through
    // to be rendered rather than thrown as a bare error.
    validateStatus: (status) => (status >= 200 && status < 300) || status === 422,
  });
  return data.data!;
}
