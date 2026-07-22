import { api } from './api';
import type { ApiResponse, BankAccount, BankTransaction, ReconciliationData, ImportBatch } from '@/types';

/* ---- Bank Accounts ---- */

export async function listBankAccounts(): Promise<BankAccount[]> {
  const { data } = await api.get<ApiResponse<BankAccount[]>>('/banking/accounts');
  return data.data ?? [];
}

export async function getBankAccount(id: string): Promise<BankAccount> {
  const { data } = await api.get<ApiResponse<BankAccount>>(`/banking/accounts/${id}`);
  return data.data!;
}

export async function createBankAccount(input: {
  accountName: string;
  bankName: string;
  accountNumber: string;
  ifscCode?: string;
  branchName?: string;
  openingBalance?: number;
  currency?: string;
  notes?: string;
}): Promise<BankAccount> {
  const { data } = await api.post<ApiResponse<BankAccount>>('/banking/accounts', input);
  return data.data!;
}

export async function updateBankAccount(
  id: string,
  input: { accountName?: string; bankName?: string; ifscCode?: string; branchName?: string; notes?: string; isActive?: boolean }
): Promise<BankAccount> {
  const { data } = await api.put<ApiResponse<BankAccount>>(`/banking/accounts/${id}`, input);
  return data.data!;
}

export async function deleteBankAccount(id: string): Promise<void> {
  await api.delete(`/banking/accounts/${id}`);
}

/* ---- Transactions ---- */

export async function listTransactions(
  bankAccountId: string,
  params: { from?: string; to?: string; status?: string; mode?: string; page?: number; limit?: number } = {}
): Promise<{ data: BankTransaction[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  const { data } = await api.get(`/banking/accounts/${bankAccountId}/transactions`, { params });
  return data;
}

export async function recordTransaction(
  bankAccountId: string,
  input: {
    transactionDate: string;
    valueDate?: string;
    amount: number;
    type: 'Credit' | 'Debit';
    mode: string;
    referenceNumber?: string;
    chequeNumber?: string;
    description?: string;
  }
): Promise<BankTransaction> {
  const { data } = await api.post<ApiResponse<BankTransaction>>(
    `/banking/accounts/${bankAccountId}/transactions`,
    input
  );
  return data.data!;
}

export async function updateTransactionStatus(
  bankAccountId: string,
  transactionId: string,
  status: string
): Promise<BankTransaction> {
  const { data } = await api.patch<ApiResponse<BankTransaction>>(
    `/banking/accounts/${bankAccountId}/transactions/${transactionId}/status`,
    { status }
  );
  return data.data!;
}

/* ---- Reconciliation ---- */

export async function getReconciliation(bankAccountId: string, batch?: string): Promise<ReconciliationData> {
  const { data } = await api.get<ApiResponse<ReconciliationData>>(
    `/banking/accounts/${bankAccountId}/reconciliation`,
    { params: batch ? { batch } : {} }
  );
  return data.data!;
}

export async function listImportBatches(bankAccountId: string): Promise<ImportBatch[]> {
  const { data } = await api.get<ApiResponse<ImportBatch[]>>(
    `/banking/accounts/${bankAccountId}/reconciliation/batches`
  );
  return data.data ?? [];
}

export async function importBankStatement(
  bankAccountId: string,
  file: File
): Promise<{ imported: number; batch: string }> {
  const form = new FormData();
  form.append('statement', file);
  const { data } = await api.post<ApiResponse<{ imported: number; batch: string }>>(
    `/banking/accounts/${bankAccountId}/reconciliation/import`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );
  return data.data!;
}

export async function manualMatch(
  bankAccountId: string,
  transactionId: string,
  statementEntryId: string
): Promise<void> {
  await api.post(`/banking/accounts/${bankAccountId}/reconciliation/match`, {
    transactionId,
    statementEntryId,
  });
}

export async function unmatch(bankAccountId: string, transactionId: string): Promise<void> {
  await api.post(`/banking/accounts/${bankAccountId}/reconciliation/unmatch`, { transactionId });
}

export async function autoReconcile(bankAccountId: string, batch?: string): Promise<{ matched: number }> {
  const { data } = await api.post<ApiResponse<{ matched: number }>>(
    `/banking/accounts/${bankAccountId}/reconciliation/auto-match`,
    batch ? { batch } : {}
  );
  return data.data!;
}
