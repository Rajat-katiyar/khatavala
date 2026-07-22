import { api } from './api';
import type {
  ApiResponse,
  Customer,
  CustomerLedger,
  CustomerPage,
  ImportResult,
  OutstandingSummary,
} from '@/types';

// No companyId is sent from the client: the backend derives it from the
// access token's tenant claim. See khatavala-backend/docs/TENANCY.md.

export interface ListCustomersParams {
  search?: string;
  sortBy?: 'name' | 'phone' | 'currentBalance' | 'creditLimit' | 'createdAt';
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  isActive?: boolean;
  hasDues?: boolean;
}

export async function listCustomers(params: ListCustomersParams = {}): Promise<CustomerPage> {
  const { data } = await api.get<ApiResponse<CustomerPage>>('/customers', { params });
  return data.data!;
}

export async function getCustomer(id: string): Promise<Customer> {
  const { data } = await api.get<ApiResponse<{ customer: Customer }>>(`/customers/${id}`);
  return data.data!.customer;
}

export interface CustomerInput {
  name: string;
  phone: string;
  email?: string;
  gstNumber?: string;
  pan?: string;
  billingAddress?: Customer['billingAddress'];
  shippingAddress?: Customer['shippingAddress'];
  creditLimit?: number;
  /** Accepted on create only — the update endpoint rejects it. */
  openingBalance?: number;
  isActive?: boolean;
}

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  const { data } = await api.post<ApiResponse<{ customer: Customer }>>('/customers', input);
  return data.data!.customer;
}

export async function updateCustomer(
  id: string,
  input: Partial<Omit<CustomerInput, 'openingBalance'>>
): Promise<Customer> {
  const { data } = await api.patch<ApiResponse<{ customer: Customer }>>(
    `/customers/${id}`,
    input
  );
  return data.data!.customer;
}

/** Hard-deletes a customer with no ledger history; deactivates one that has it. */
export async function deleteCustomer(
  id: string
): Promise<{ deleted: boolean; deactivated: boolean }> {
  const { data } = await api.delete<ApiResponse<{ deleted: boolean; deactivated: boolean }>>(
    `/customers/${id}`
  );
  return data.data!;
}

export async function getLedger(
  id: string,
  params: { from?: string; to?: string; page?: number; limit?: number } = {}
): Promise<CustomerLedger> {
  const { data } = await api.get<ApiResponse<CustomerLedger>>(`/customers/${id}/ledger`, {
    params,
  });
  return data.data!;
}

export async function getOutstanding(): Promise<OutstandingSummary> {
  const { data } = await api.get<ApiResponse<OutstandingSummary>>('/customers/outstanding');
  return data.data!;
}

/**
 * Downloads the import template and hands it to the browser as a file.
 *
 * `responseType: 'blob'` matters — the default string transform would corrupt
 * the binary .xlsx, and the saved file would fail to open in Excel.
 */
export async function downloadTemplate(): Promise<void> {
  const { data } = await api.get('/customers/import/template', { responseType: 'blob' });
  const url = URL.createObjectURL(data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'khatavala-customer-import-template.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * @param dryRun validate and report without writing — used to preview an
 *   import before committing to it.
 */
export async function importCustomers(file: File, dryRun = false): Promise<ImportResult> {
  const form = new FormData();
  form.append('file', file);

  const { data } = await api.post<ApiResponse<ImportResult>>('/customers/import', form, {
    params: { dryRun },
    // Undefined, not 'multipart/form-data': the browser has to set this header
    // itself so it can append the multipart boundary. Hard-coding it produces a
    // body the server cannot parse.
    headers: { 'Content-Type': undefined },
    // A 422 (every row failed) still carries a usable report, so let it through
    // to be rendered rather than thrown as a bare error.
    validateStatus: (status) => (status >= 200 && status < 300) || status === 422,
  });
  return data.data!;
}
