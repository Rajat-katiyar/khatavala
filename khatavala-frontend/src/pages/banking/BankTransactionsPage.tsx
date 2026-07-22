import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, ArrowUpRight, ArrowDownLeft, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
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
import * as bankingService from '@/services/banking.service';
import type { BankAccount, BankTransaction } from '@/types';

export function BankTransactionsPage() {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const currency = useCompanyStore((s) => s.activeCompany?.currency ?? 'INR');
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [account, setAccount] = useState<BankAccount | null>(null);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    transactionDate: new Date().toISOString().split('T')[0],
    amount: '',
    type: 'Credit' as 'Credit' | 'Debit',
    mode: 'NEFT',
    referenceNumber: '',
    chequeNumber: '',
    description: '',
  });

  const loadData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const [acc, txnRes] = await Promise.all([
        bankingService.getBankAccount(accountId),
        bankingService.listTransactions(accountId),
      ]);
      setAccount(acc);
      setTransactions(txnRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    void loadData();
  }, [loadData, tenantVersion]);

  const handleRecordTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;
    if (!formData.amount || parseFloat(formData.amount) <= 0) {
      setFormError('Amount must be greater than zero');
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await bankingService.recordTransaction(accountId, {
        transactionDate: new Date(formData.transactionDate).toISOString(),
        amount: parseFloat(formData.amount),
        type: formData.type,
        mode: formData.mode,
        referenceNumber: formData.referenceNumber || undefined,
        chequeNumber: formData.chequeNumber || undefined,
        description: formData.description || undefined,
      });

      setIsModalOpen(false);
      setFormData({
        transactionDate: new Date().toISOString().split('T')[0],
        amount: '',
        type: 'Credit',
        mode: 'NEFT',
        referenceNumber: '',
        chequeNumber: '',
        description: '',
      });
      void loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to record transaction');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (transactionId: string, status: string) => {
    if (!accountId) return;
    try {
      await bankingService.updateTransactionStatus(accountId, transactionId, status);
      void loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update transaction status');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" onClick={() => navigate('/banking/accounts')}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {account ? account.accountName : 'Transaction Register'}
            </h1>
            <p className="text-sm text-gray-500">
              {account ? `${account.bankName} • A/C ${account.accountNumber}` : 'Bank Register'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {account && (
            <div className="mr-4 text-right">
              <div className="text-xs text-gray-500 uppercase">Current Balance</div>
              <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {formatMoney(account.currentBalance, currency)}
              </div>
            </div>
          )}
          <Button size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" /> Record Transaction
          </Button>
        </div>
      </div>

      {error && <div className="p-4 text-sm text-red-600 bg-red-50 rounded-md">{error}</div>}

      <div className="border rounded-lg bg-white dark:bg-gray-800 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Ref / Cheque #</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                  Loading transactions...
                </TableCell>
              </TableRow>
            ) : transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                  No bank transactions recorded.
                </TableCell>
              </TableRow>
            ) : (
              transactions.map((t) => (
                <TableRow key={t._id}>
                  <TableCell>{new Date(t.transactionDate).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {t.type === 'Credit' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600 dark:text-green-400">
                        <ArrowDownLeft className="w-3.5 h-3.5" /> Credit
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 dark:text-red-400">
                        <ArrowUpRight className="w-3.5 h-3.5" /> Debit
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.mode}</TableCell>
                  <TableCell className="font-mono text-xs">{t.referenceNumber || t.chequeNumber || '-'}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-gray-600 dark:text-gray-300">
                    {t.description || '-'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatMoney(t.amount, currency)}
                  </TableCell>
                  <TableCell>
                    {t.status === 'Cleared' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        <CheckCircle2 className="w-3 h-3" /> Cleared
                      </span>
                    ) : t.status === 'Pending' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        <Clock className="w-3 h-3" /> Pending
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                        <AlertTriangle className="w-3 h-3" /> Bounced
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <select
                      className="text-xs border rounded px-1.5 py-1 bg-white dark:bg-gray-800"
                      value={t.status}
                      onChange={(e) => handleStatusChange(t._id, e.target.value)}
                    >
                      <option value="Pending">Pending</option>
                      <option value="Cleared">Cleared</option>
                      <option value="Bounced">Bounced</option>
                    </select>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Record Transaction Modal */}
      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title="Record Bank Transaction">
        <form onSubmit={handleRecordTransaction} className="space-y-4">
          {formError && <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">{formError}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type *</label>
              <select
                className="w-full border rounded px-3 py-2 bg-white dark:bg-gray-800"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value as 'Credit' | 'Debit' })}
              >
                <option value="Credit">Credit (Deposit / Money In)</option>
                <option value="Debit">Debit (Withdrawal / Money Out)</option>
              </select>
            </div>
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Transaction Date *</label>
              <Input
                type="date"
                value={formData.transactionDate}
                onChange={(e) => setFormData({ ...formData, transactionDate: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Mode *</label>
              <select
                className="w-full border rounded px-3 py-2 bg-white dark:bg-gray-800"
                value={formData.mode}
                onChange={(e) => setFormData({ ...formData, mode: e.target.value })}
              >
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
                <option value="IMPS">IMPS</option>
                <option value="UPI">UPI</option>
                <option value="Cheque">Cheque</option>
                <option value="Cash">Cash Deposit/Withdrawal</option>
                <option value="DirectDebit">Direct Debit</option>
                <option value="Interest">Interest Received</option>
                <option value="Charges">Bank Charges</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Ref / UTR Number</label>
              <Input
                type="text"
                placeholder="e.g. N123456789"
                value={formData.referenceNumber}
                onChange={(e) => setFormData({ ...formData, referenceNumber: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Cheque Number</label>
              <Input
                type="text"
                placeholder="e.g. 000123"
                value={formData.chequeNumber}
                onChange={(e) => setFormData({ ...formData, chequeNumber: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description / Remarks</label>
            <Input
              type="text"
              placeholder="e.g. Payment for vendor invoice"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Recording...' : 'Record Transaction'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

