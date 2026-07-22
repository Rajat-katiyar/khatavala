import { api } from './api';
import type { ApiResponse, ExpenseCategory, Expense, ExpenseSummary } from '@/types';

export interface ListExpensesParams {
  categoryId?: string;
  from?: string;
  to?: string;
  isRecurring?: boolean;
  status?: string;
  page?: number;
  limit?: number;
}

/* ---- Categories ---- */

export async function listCategories(): Promise<ExpenseCategory[]> {
  const { data } = await api.get<ApiResponse<ExpenseCategory[]>>('/expenses/categories');
  return data.data ?? [];
}

export async function createCategory(input: { name: string; description?: string }): Promise<ExpenseCategory> {
  const { data } = await api.post<ApiResponse<ExpenseCategory>>('/expenses/categories', input);
  return data.data!;
}

export async function updateCategory(
  id: string,
  input: { name?: string; description?: string; isActive?: boolean }
): Promise<ExpenseCategory> {
  const { data } = await api.put<ApiResponse<ExpenseCategory>>(`/expenses/categories/${id}`, input);
  return data.data!;
}

export async function deleteCategory(id: string): Promise<void> {
  await api.delete(`/expenses/categories/${id}`);
}

/* ---- Expenses ---- */

export async function listExpenses(params: ListExpensesParams = {}): Promise<{
  data: Expense[];
  pagination: { page: number; limit: number; total: number; pages: number };
}> {
  const { data } = await api.get('/expenses', { params });
  return data;
}

export async function createExpense(input: {
  categoryId: string;
  amount: number;
  date?: string;
  paymentMode: string;
  description?: string;
  referenceNumber?: string;
  isRecurring?: boolean;
  recurrenceFrequency?: string;
}): Promise<Expense> {
  const { data } = await api.post<ApiResponse<Expense>>('/expenses', input);
  return data.data!;
}

export async function getExpense(id: string): Promise<Expense> {
  const { data } = await api.get<ApiResponse<Expense>>(`/expenses/${id}`);
  return data.data!;
}

export async function deleteExpense(id: string): Promise<void> {
  await api.delete(`/expenses/${id}`);
}

export async function getExpenseSummary(params: { from?: string; to?: string } = {}): Promise<ExpenseSummary> {
  const { data } = await api.get<ApiResponse<ExpenseSummary>>('/expenses/summary', { params });
  return data.data!;
}

export async function triggerRecurringProcess(): Promise<{ generated: number }> {
  const { data } = await api.post<ApiResponse<{ generated: number }>>('/expenses/recurring/process');
  return data.data!;
}
