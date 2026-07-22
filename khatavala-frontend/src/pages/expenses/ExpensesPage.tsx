import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Filter, Trash2, Repeat } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatMoney } from '@/lib/utils';
import { useCompanyStore } from '@/store/companyStore';
import * as expenseService from '@/services/expenses.service';
import type { Expense, ExpenseCategory } from '@/types';

export function ExpensesPage() {
  const currency = useCompanyStore((s) => s.activeCompany?.currency ?? 'INR');
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [isRecurringFilter, setIsRecurringFilter] = useState<boolean | undefined>(undefined);

  // Add Expense Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    categoryId: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    paymentMode: 'Cash',
    description: '',
    referenceNumber: '',
    isRecurring: false,
    recurrenceFrequency: 'monthly',
  });

  // Processing state for manual trigger
  const [processingRecurring, setProcessingRecurring] = useState(false);
  const [recurringMessage, setRecurringMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, expRes] = await Promise.all([
        expenseService.listCategories(),
        expenseService.listExpenses({
          categoryId: selectedCategory || undefined,
          isRecurring: isRecurringFilter,
        }),
      ]);
      setCategories(cats);
      setExpenses(expRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expenses');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, isRecurringFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData, tenantVersion]);

  const handleCreateExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.categoryId) {
      setFormError('Please select a category');
      return;
    }
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      setFormError('Please enter a valid positive amount');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await expenseService.createExpense({
        categoryId: formData.categoryId,
        amount: parseFloat(formData.amount),
        date: formData.date ? new Date(formData.date).toISOString() : undefined,
        paymentMode: formData.paymentMode,
        description: formData.description,
        referenceNumber: formData.referenceNumber || undefined,
        isRecurring: formData.isRecurring,
        recurrenceFrequency: formData.isRecurring ? formData.recurrenceFrequency : undefined,
      });

      setIsModalOpen(false);
      setFormData({
        categoryId: '',
        amount: '',
        date: new Date().toISOString().split('T')[0],
        paymentMode: 'Cash',
        description: '',
        referenceNumber: '',
        isRecurring: false,
        recurrenceFrequency: 'monthly',
      });
      void loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create expense');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm('Are you sure you want to delete this expense?')) return;
    try {
      await expenseService.deleteExpense(id);
      void loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete expense');
    }
  };

  const handleTriggerRecurring = async () => {
    setProcessingRecurring(true);
    setRecurringMessage(null);
    try {
      const res = await expenseService.triggerRecurringProcess();
      setRecurringMessage(`Processed! ${res.generated} recurring expense(s) auto-generated.`);
      void loadData();
    } catch (err) {
      setRecurringMessage(err instanceof Error ? err.message : 'Failed to process recurring expenses');
    } finally {
      setProcessingRecurring(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <p className="text-sm text-gray-500">Record, filter, and manage company spending</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleTriggerRecurring}
            disabled={processingRecurring}
            title="Run overdue recurring expenses scheduler now"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${processingRecurring ? 'animate-spin' : ''}`} />
            Process Recurring
          </Button>
          <Button size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add Expense
          </Button>
        </div>
      </div>

      {recurringMessage && (
        <div className="p-3 text-sm rounded bg-blue-50 text-blue-700 border border-blue-200">
          {recurringMessage}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-medium">Filter:</span>
        </div>
        <select
          className="text-sm border rounded px-3 py-1.5 bg-white dark:bg-gray-800"
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </select>

        <select
          className="text-sm border rounded px-3 py-1.5 bg-white dark:bg-gray-800"
          value={isRecurringFilter === undefined ? '' : String(isRecurringFilter)}
          onChange={(e) => {
            const val = e.target.value;
            setIsRecurringFilter(val === '' ? undefined : val === 'true');
          }}
        >
          <option value="">All Types</option>
          <option value="false">One-time Expenses</option>
          <option value="true">Recurring Schedules</option>
        </select>

        {(selectedCategory || isRecurringFilter !== undefined) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedCategory('');
              setIsRecurringFilter(undefined);
            }}
          >
            Reset
          </Button>
        )}
      </div>

      {error && <div className="p-4 text-sm text-red-600 bg-red-50 rounded-md">{error}</div>}

      {/* Expenses Table */}
      <div className="border rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Doc #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Payment Mode</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                  Loading expenses...
                </TableCell>
              </TableRow>
            ) : expenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                  No expenses found.
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((ex) => {
                const categoryName =
                  typeof ex.categoryId === 'object' && ex.categoryId
                    ? ex.categoryId.name
                    : ex.categoryName;
                return (
                  <TableRow key={ex._id}>
                    <TableCell className="font-mono text-xs">{ex.documentNumber}</TableCell>
                    <TableCell>{new Date(ex.date).toLocaleDateString()}</TableCell>
                    <TableCell className="font-medium">{categoryName}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-gray-600 dark:text-gray-300">
                      {ex.description || '-'}
                    </TableCell>
                    <TableCell>
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                        {ex.paymentMode}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(ex.amount, currency)}
                    </TableCell>
                    <TableCell>
                      {ex.isRecurring ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                          <Repeat className="w-3 h-3" /> {ex.recurrenceFrequency}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">One-time</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteExpense(ex._id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add Expense Modal */}
      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title="Record New Expense">
        <form onSubmit={handleCreateExpense} className="space-y-4">
          {formError && <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">{formError}</div>}

          <div>
            <label className="block text-sm font-medium mb-1">Category *</label>
            <select
              className="w-full border rounded px-3 py-2 bg-white dark:bg-gray-800"
              value={formData.categoryId}
              onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
              required
            >
              <option value="">Select Category</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Amount ({currency}) *</label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Date *</label>
              <Input
                type="date"
                value={formData.date}
                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Payment Mode *</label>
              <select
                className="w-full border rounded px-3 py-2 bg-white dark:bg-gray-800"
                value={formData.paymentMode}
                onChange={(e) => setFormData({ ...formData, paymentMode: e.target.value })}
              >
                <option value="Cash">Cash</option>
                <option value="UPI">UPI</option>
                <option value="Bank">Bank Transfer</option>
                <option value="Card">Card</option>
                <option value="Cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ref / Cheque #</label>
              <Input
                type="text"
                placeholder="Optional"
                value={formData.referenceNumber}
                onChange={(e) => setFormData({ ...formData, referenceNumber: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description / Narration</label>
            <Input
              type="text"
              placeholder="e.g. Office electricity bill for June"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="pt-2 border-t space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isRecurring"
                checked={formData.isRecurring}
                onChange={(e) => setFormData({ ...formData, isRecurring: e.target.checked })}
                className="rounded text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="isRecurring" className="text-sm font-medium cursor-pointer">
                Is this a recurring expense schedule?
              </label>
            </div>

            {formData.isRecurring && (
              <div>
                <label className="block text-xs font-medium mb-1 text-gray-500">Recurrence Frequency</label>
                <select
                  className="w-full border rounded px-3 py-1.5 text-sm bg-white dark:bg-gray-800"
                  value={formData.recurrenceFrequency}
                  onChange={(e) => setFormData({ ...formData, recurrenceFrequency: e.target.value })}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Recording...' : 'Record Expense'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

