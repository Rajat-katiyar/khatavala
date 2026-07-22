import { api } from './api';
import type {
  AccountLedger,
  AccountNode,
  Account,
  AccountType,
  ApiResponse,
  JournalEntry,
  JournalEntryPage,
  JournalSourceType,
  TrialBalance,
} from '@/types';

// No companyId is sent from the client: the backend derives it from the
// access token's tenant claim. See khatavala-backend/docs/TENANCY.md.

/* ------------------------ Chart of accounts ------------------------ */

export async function getAccountTree(includeInactive = false): Promise<AccountNode[]> {
  const { data } = await api.get<ApiResponse<{ tree: AccountNode[] }>>(
    '/accounting/accounts/tree',
    { params: includeInactive ? { includeInactive: true } : undefined }
  );
  return data.data!.tree;
}

export async function listAccounts(
  params: { type?: AccountType; includeInactive?: boolean } = {}
): Promise<Account[]> {
  const { data } = await api.get<ApiResponse<{ accounts: Account[] }>>(
    '/accounting/accounts',
    { params }
  );
  return data.data!.accounts;
}

export interface AccountInput {
  accountName: string;
  accountType: AccountType;
  code?: string | null;
  parentAccountId?: string | null;
  description?: string | null;
  isActive?: boolean;
}

export async function createAccount(input: AccountInput): Promise<Account> {
  const { data } = await api.post<ApiResponse<{ account: Account }>>(
    '/accounting/accounts',
    input
  );
  return data.data!.account;
}

export async function updateAccount(
  id: string,
  input: Partial<AccountInput>
): Promise<Account> {
  const { data } = await api.patch<ApiResponse<{ account: Account }>>(
    `/accounting/accounts/${id}`,
    input
  );
  return data.data!.account;
}

export async function deleteAccount(
  id: string
): Promise<{ deleted: boolean; deactivated: boolean }> {
  const { data } = await api.delete<ApiResponse<{ deleted: boolean; deactivated: boolean }>>(
    `/accounting/accounts/${id}`
  );
  return data.data!;
}

/* -------------------------- Journal entries ------------------------ */

export async function listJournalEntries(
  params: {
    from?: string;
    to?: string;
    sourceType?: JournalSourceType;
    accountId?: string;
    page?: number;
    limit?: number;
  } = {}
): Promise<JournalEntryPage> {
  const { data } = await api.get<ApiResponse<JournalEntryPage>>(
    '/accounting/journal-entries',
    { params }
  );
  return data.data!;
}

export async function createJournalEntry(input: {
  date?: string;
  narration?: string | null;
  lines: Array<{
    accountId: string;
    debitAmount?: number;
    creditAmount?: number;
    description?: string | null;
  }>;
}): Promise<JournalEntry> {
  const { data } = await api.post<ApiResponse<{ entry: JournalEntry }>>(
    '/accounting/journal-entries',
    input
  );
  return data.data!.entry;
}

export async function createContraEntry(input: {
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date?: string;
  narration?: string | null;
}): Promise<JournalEntry> {
  const { data } = await api.post<ApiResponse<{ entry: JournalEntry }>>(
    '/accounting/journal-entries/contra',
    input
  );
  return data.data!.entry;
}

/* ------------------------------ Reports ---------------------------- */

interface LedgerParams {
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export async function getAccountLedger(
  accountId: string,
  params: LedgerParams = {}
): Promise<AccountLedger> {
  const { data } = await api.get<ApiResponse<AccountLedger>>(
    `/accounting/ledger/${accountId}`,
    { params }
  );
  return data.data!;
}

export async function getCashBook(params: LedgerParams = {}): Promise<AccountLedger> {
  const { data } = await api.get<ApiResponse<AccountLedger>>('/accounting/cash-book', {
    params,
  });
  return data.data!;
}

export async function getBankBook(params: LedgerParams = {}): Promise<AccountLedger> {
  const { data } = await api.get<ApiResponse<AccountLedger>>('/accounting/bank-book', {
    params,
  });
  return data.data!;
}

export async function getTrialBalance(
  params: { from?: string; to?: string } = {}
): Promise<TrialBalance> {
  const { data } = await api.get<ApiResponse<TrialBalance>>('/accounting/trial-balance', {
    params,
  });
  return data.data!;
}
