import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
import { useCompanyStore } from '@/store/companyStore';
import * as expenseService from '@/services/expenses.service';
import type { ExpenseCategory } from '@/types';

export function ExpenseCategorySettings() {
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await expenseService.listCategories();
      setCategories(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load categories');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories, tenantVersion]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError('Category name is required');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await expenseService.createCategory({ name, description });
      setIsModalOpen(false);
      setName('');
      setDescription('');
      void loadCategories();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create category');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (cat: ExpenseCategory) => {
    if (cat.systemKey) {
      alert('System pre-seeded categories cannot be deleted.');
      return;
    }
    if (!confirm(`Are you sure you want to delete category "${cat.name}"?`)) return;

    try {
      await expenseService.deleteCategory(cat._id);
      void loadCategories();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete category');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expense Categories</h1>
          <p className="text-sm text-gray-500">Manage categories and their chart of accounts mappings</p>
        </div>
        <Button size="sm" onClick={() => setIsModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Add Category
        </Button>
      </div>

      {error && <div className="p-4 text-sm text-red-600 bg-red-50 rounded-md">{error}</div>}

      <div className="border rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                  Loading categories...
                </TableCell>
              </TableRow>
            ) : categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-gray-500">
                  No categories found.
                </TableCell>
              </TableRow>
            ) : (
              categories.map((c) => (
                <TableRow key={c._id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-gray-500">{c.description || '-'}</TableCell>
                  <TableCell>
                    {c.systemKey ? (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        System Default
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                        Custom
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {!c.systemKey && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(c)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add Expense Category">
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">{formError}</div>}

          <div>
            <label className="block text-sm font-medium mb-1">Category Name *</label>
            <Input
              type="text"
              placeholder="e.g. Software Subscriptions"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <Input
              type="text"
              placeholder="Brief description of this expense type"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Category'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

