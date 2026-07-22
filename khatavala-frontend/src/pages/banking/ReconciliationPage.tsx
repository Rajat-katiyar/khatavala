import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Upload,
  Zap,
  ArrowRightLeft,
  FileSpreadsheet,
  Link,
  Unlink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/utils';
import { useCompanyStore } from '@/store/companyStore';
import * as bankingService from '@/services/banking.service';
import type { BankAccount, ReconciliationData } from '@/types';

export function ReconciliationPage() {
  const [searchParams] = useSearchParams();
  const currency = useCompanyStore((s) => s.activeCompany?.currency ?? 'INR');
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const initialAccountId = searchParams.get('accountId') || '';

  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(initialAccountId);
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // File Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  // Auto match state
  const [autoMatching, setAutoMatching] = useState(false);

  // Selection for manual matching
  const [selectedStatementId, setSelectedStatementId] = useState<string | null>(null);
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    try {
      const list = await bankingService.listBankAccounts();
      setAccounts(list);
      if (!selectedAccountId && list.length > 0) {
        setSelectedAccountId(list[0]._id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bank accounts');
    }
  }, [selectedAccountId]);

  const loadReconciliation = useCallback(async () => {
    if (!selectedAccountId) return;
    setLoading(true);
    setError(null);
    try {
      const recon = await bankingService.getReconciliation(selectedAccountId);
      setData(recon);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reconciliation data');
    } finally {
      setLoading(false);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts, tenantVersion]);

  useEffect(() => {
    if (selectedAccountId) {
      void loadReconciliation();
    }
  }, [selectedAccountId, loadReconciliation]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedAccountId) return;

    setUploading(true);
    setUploadMsg(null);
    setError(null);
    try {
      const res = await bankingService.importBankStatement(selectedAccountId, file);
      setUploadMsg(`Successfully imported ${res.imported} statement entries!`);
      void loadReconciliation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleAutoMatch = async () => {
    if (!selectedAccountId) return;
    setAutoMatching(true);
    setError(null);
    try {
      const res = await bankingService.autoReconcile(selectedAccountId);
      setUploadMsg(`Auto-reconciled ${res.matched} entry pairs!`);
      void loadReconciliation();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-match failed');
    } finally {
      setAutoMatching(false);
    }
  };

  const handleManualMatch = async () => {
    if (!selectedAccountId || !selectedStatementId || !selectedTransactionId) return;
    try {
      await bankingService.manualMatch(
        selectedAccountId,
        selectedTransactionId,
        selectedStatementId
      );
      setSelectedStatementId(null);
      setSelectedTransactionId(null);
      void loadReconciliation();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Match failed');
    }
  };

  const handleUnmatch = async (transactionId: string) => {
    if (!selectedAccountId) return;
    try {
      await bankingService.unmatch(selectedAccountId, transactionId);
      void loadReconciliation();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unmatch failed');
    }
  };

  

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bank Statement Reconciliation</h1>
          <p className="text-sm text-gray-500">
            Upload bank statement (CSV/Excel) and match against recorded system transactions
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            className="text-sm font-medium border rounded px-3 py-2 bg-white dark:bg-gray-800"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a._id} value={a._id}>
                {a.accountName} ({a.bankName})
              </option>
            ))}
          </select>

          <label className="cursor-pointer">
            <input
              type="file"
              accept=".csv, .xlsx, .xls"
              onChange={handleFileUpload}
              className="hidden"
              disabled={uploading || !selectedAccountId}
            />
            <span className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2">
              <Upload className="w-4 h-4 mr-2" />
              {uploading ? 'Importing...' : 'Upload Statement'}
            </span>
          </label>

          <Button
            variant="outline"
            size="sm"
            onClick={handleAutoMatch}
            disabled={autoMatching || !selectedAccountId}
            title="Auto-match entries with same amount within ±3 days"
          >
            <Zap className={`w-4 h-4 mr-1 text-amber-500 ${autoMatching ? 'animate-bounce' : ''}`} />
            Auto Match
          </Button>
        </div>
      </div>

      {uploadMsg && (
        <div className="p-3 text-sm rounded bg-green-50 text-green-700 border border-green-200">
          {uploadMsg}
        </div>
      )}

      {error && <div className="p-4 text-sm text-red-600 bg-red-50 rounded-md">{error}</div>}

      {/* Manual match action banner */}
      {selectedStatementId && selectedTransactionId && (
        <div className="p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-900 dark:text-blue-100">
            <Link className="w-4 h-4 text-blue-600" />
            Selected 1 Statement Entry and 1 System Transaction for manual matching.
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelectedStatementId(null);
                setSelectedTransactionId(null);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleManualMatch}>
              Confirm Match
            </Button>
          </div>
        </div>
      )}

      {/* Side-by-Side Matching Panel */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading reconciliation entries...</div>
      ) : !data ? (
        <div className="text-center py-12 text-gray-500">Select a bank account to begin</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Panel: Imported Statement Entries */}
          <Card className="h-fit">
            <CardHeader className="pb-3 border-b bg-gray-50/50 dark:bg-gray-800/50">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-blue-600" /> Bank Statement Entries
                </CardTitle>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700 font-medium">
                  {data.unmatched.statements.length} Unmatched
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-y-auto divide-y">
                {data.statements.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-500">
                    No statement entries imported yet. Upload a CSV/Excel bank statement above.
                  </div>
                ) : (
                  data.statements.map((s) => {
                    const isSelected = selectedStatementId === s._id;
                    return (
                      <div
                        key={s._id}
                        onClick={() => {
                          if (s.isMatched) return;
                          setSelectedStatementId(isSelected ? null : s._id);
                        }}
                        className={`p-3 text-xs transition-colors flex items-center justify-between ${
                          s.isMatched
                            ? 'bg-green-50/40 dark:bg-green-950/20 opacity-75'
                            : isSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40 border-l-4 border-blue-600'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <span>{new Date(s.statementDate).toLocaleDateString()}</span>
                            {s.isMatched && (
                              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-sans">
                                Matched
                              </span>
                            )}
                          </div>
                          <div className="text-gray-500 max-w-[240px] truncate">
                            {s.description || s.referenceNumber || 'Entry'}
                          </div>
                        </div>

                        <div className="text-right">
                          {s.credit > 0 ? (
                            <span className="font-bold text-green-600">
                              +{formatMoney(s.credit, currency)}
                            </span>
                          ) : (
                            <span className="font-bold text-red-600">
                              -{formatMoney(s.debit, currency)}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>

          {/* Right Panel: System Transactions */}
          <Card className="h-fit">
            <CardHeader className="pb-3 border-b bg-gray-50/50 dark:bg-gray-800/50">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-purple-600" /> Recorded System Transactions
                </CardTitle>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-700 font-medium">
                  {data.unmatched.transactions.length} Pending
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-y-auto divide-y">
                {data.transactions.length === 0 ? (
                  <div className="p-6 text-center text-sm text-gray-500">
                    No system transactions recorded for this account.
                  </div>
                ) : (
                  data.transactions.map((t) => {
                    const isMatched = t.status === 'Cleared';
                    const isSelected = selectedTransactionId === t._id;
                    return (
                      <div
                        key={t._id}
                        onClick={() => {
                          if (isMatched) return;
                          setSelectedTransactionId(isSelected ? null : t._id);
                        }}
                        className={`p-3 text-xs transition-colors flex items-center justify-between ${
                          isMatched
                            ? 'bg-green-50/40 dark:bg-green-950/20'
                            : isSelected
                            ? 'bg-blue-100 dark:bg-blue-900/40 border-l-4 border-blue-600'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                            <span>{new Date(t.transactionDate).toLocaleDateString()}</span>
                            <span className="font-mono text-[10px] text-gray-500">({t.mode})</span>
                            {isMatched && (
                              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-sans">
                                Cleared
                              </span>
                            )}
                          </div>
                          <div className="text-gray-500 max-w-[240px] truncate">
                            {t.description || t.referenceNumber || 'Transaction'}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 text-right">
                          {t.type === 'Credit' ? (
                            <span className="font-bold text-green-600">
                              +{formatMoney(t.amount, currency)}
                            </span>
                          ) : (
                            <span className="font-bold text-red-600">
                              -{formatMoney(t.amount, currency)}
                            </span>
                          )}

                          {isMatched && (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Unmatch this transaction"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUnmatch(t._id);
                              }}
                              className="text-gray-400 hover:text-red-600 p-1 h-auto"
                            >
                              <Unlink className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}


