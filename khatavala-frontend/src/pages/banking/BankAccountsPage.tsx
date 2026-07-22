import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Building2, CreditCard, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/utils';
import { useCompanyStore } from '@/store/companyStore';
import * as bankingService from '@/services/banking.service';
import type { BankAccount } from '@/types';

export function BankAccountsPage() {
  const navigate = useNavigate();
  const currency = useCompanyStore((s) => s.activeCompany?.currency ?? 'INR');
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    accountName: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    branchName: '',
    openingBalance: '0',
  });

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await bankingService.listBankAccounts();
      setAccounts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bank accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts, tenantVersion]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.accountName || !formData.bankName || !formData.accountNumber) {
      setFormError('Account name, bank name, and account number are required');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await bankingService.createBankAccount({
        accountName: formData.accountName,
        bankName: formData.bankName,
        accountNumber: formData.accountNumber,
        ifscCode: formData.ifscCode || undefined,
        branchName: formData.branchName || undefined,
        openingBalance: parseFloat(formData.openingBalance) || 0,
      });

      setIsModalOpen(false);
      setFormData({
        accountName: '',
        bankName: '',
        accountNumber: '',
        ifscCode: '',
        branchName: '',
        openingBalance: '0',
      });
      void loadAccounts();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add bank account');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Banking & Accounts</h1>
          <p className="text-sm text-gray-500">Manage bank accounts, transaction records, and reconciliations</p>
        </div>
        <Button size="sm" onClick={() => setIsModalOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Add Bank Account
        </Button>
      </div>

      {error && <div className="p-4 text-sm text-red-600 bg-red-50 rounded-md">{error}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading bank accounts...</div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-gray-50 dark:bg-gray-900">
          <Building2 className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">No Bank Accounts Found</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto mt-1 mb-4">
            Add your company bank accounts to track balances, record transactions, and perform statement reconciliation.
          </p>
          <Button size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Add First Account
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((acc) => (
            <Card key={acc._id} className="relative overflow-hidden hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2 border-b bg-gray-50/50 dark:bg-gray-800/50">
                <div>
                  <CardTitle className="text-base font-semibold">{acc.accountName}</CardTitle>
                  <p className="text-xs text-gray-500">{acc.bankName}</p>
                </div>
                <div className="p-2 bg-blue-50 text-blue-600 dark:bg-blue-900/30 rounded-full">
                  <CreditCard className="w-5 h-5" />
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div>
                  <span className="text-xs text-gray-500 uppercase tracking-wider">Current Balance</span>
                  <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    {formatMoney(acc.currentBalance, currency)}
                  </div>
                </div>

                <div className="text-xs space-y-1 text-gray-600 dark:text-gray-300 font-mono bg-gray-50 dark:bg-gray-900 p-2.5 rounded">
                  <div className="flex justify-between">
                    <span className="text-gray-400 font-sans">A/C No:</span>
                    <span>{acc.accountNumber}</span>
                  </div>
                  {acc.ifscCode && (
                    <div className="flex justify-between">
                      <span className="text-gray-400 font-sans">IFSC:</span>
                      <span>{acc.ifscCode}</span>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex items-center justify-between gap-2 border-t">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => navigate(`/banking/accounts/${acc._id}/transactions`)}
                  >
                    Register
                  </Button>
                  <Button
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => navigate(`/banking/reconciliation?accountId=${acc._id}`)}
                  >
                    Reconcile <ArrowUpRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Bank Account Modal */}
      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title="Add Bank Account">
        <form onSubmit={handleCreate} className="space-y-4">
          {formError && <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">{formError}</div>}

          <div>
            <label className="block text-sm font-medium mb-1">Account Display Name *</label>
            <Input
              type="text"
              placeholder="e.g. HDFC Primary Current A/C"
              value={formData.accountName}
              onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bank Name *</label>
              <Input
                type="text"
                placeholder="e.g. HDFC Bank"
                value={formData.bankName}
                onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Account Number *</label>
              <Input
                type="text"
                placeholder="e.g. 50200012345678"
                value={formData.accountNumber}
                onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">IFSC Code</label>
              <Input
                type="text"
                placeholder="e.g. HDFC0001234"
                value={formData.ifscCode}
                onChange={(e) => setFormData({ ...formData, ifscCode: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Branch Name</label>
              <Input
                type="text"
                placeholder="e.g. MG Road Branch"
                value={formData.branchName}
                onChange={(e) => setFormData({ ...formData, branchName: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Opening Balance ({currency})</label>
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={formData.openingBalance}
              onChange={(e) => setFormData({ ...formData, openingBalance: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Add Account'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

