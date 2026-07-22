import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanyStore } from '@/store/companyStore';
import { formatDate, formatMoney } from '@/lib/utils';
import * as reportsService from '@/services/reports.service';
import type { DrillDownKey, DrillDownResult, JournalSourceType } from '@/types';

/**
 * The transactions behind a report line.
 *
 * Opened by clicking any figure on any statement. Every row links back to the
 * DOCUMENT that caused it — the invoice, the bill, the payment — not merely to
 * the journal entry, because "why is receivables 2,025?" is answered by the
 * invoice, not by a voucher number.
 */

/** Where each source type lives, so a drill-down row can be clicked through. */
const SOURCE_PATH: Partial<Record<JournalSourceType, string>> = {
  SalesInvoice: '/sales/invoices',
  PurchaseInvoice: '/purchase/invoices',
  CreditNote: '/sales/invoices',
  DebitNote: '/purchase/invoices',
};

const SOURCE_LABEL: Record<string, string> = {
  SalesInvoice: 'Sales invoice',
  PurchaseInvoice: 'Purchase bill',
  CustomerReceipt: 'Receipt',
  SupplierPayment: 'Payment',
  CreditNote: 'Credit note',
  DebitNote: 'Debit note',
};

export function DrillDownPanel({
  drillDown,
  label,
  onClose,
}: {
  drillDown: (DrillDownKey & { label?: string }) | null;
  label?: string;
  onClose: () => void;
}) {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [result, setResult] = useState<DrillDownResult | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!drillDown) return;
    setLoading(true);
    try {
      setResult(
        await reportsService.getDrillDown({
          accountId: drillDown.accountId,
          from: drillDown.from,
          to: drillDown.to,
          page,
        })
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the transactions');
    } finally {
      setLoading(false);
    }
  }, [drillDown, page]);

  useEffect(() => {
    setPage(1);
  }, [drillDown?.accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Modal
      open={!!drillDown}
      onClose={onClose}
      title={label ?? result?.account.accountName ?? 'Transactions'}
      description={
        result
          ? `${result.pagination.total} line${result.pagination.total === 1 ? '' : 's'} · net ${formatMoney(result.totals.net, currency)}`
          : undefined
      }
      className="max-w-4xl"
    >
      <div className="space-y-4">
        {loading && !result ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading transactions…
          </p>
        ) : error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : result && result.rows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            Nothing posted to this account in this period.
          </p>
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Date</TableHead>
                  <TableHead className="w-28">Entry</TableHead>
                  <TableHead>Particulars</TableHead>
                  <TableHead className="w-32">Source</TableHead>
                  <TableHead className="w-24 text-right">Debit</TableHead>
                  <TableHead className="w-24 text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result?.rows.map((row, index) => {
                  const path = SOURCE_PATH[row.sourceType];
                  return (
                    <TableRow key={`${row.entryId}-${index}`}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(row.date)}
                      </TableCell>
                      <TableCell className="font-medium">{row.documentNumber}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {row.description || row.narration || '—'}
                      </TableCell>
                      <TableCell>
                        {row.sourceNumber ? (
                          path && row.sourceId ? (
                            // Straight through to the document, which is what
                            // the reader actually wants to see.
                            <Link
                              to={`${path}/${row.sourceId}`}
                              className="inline-flex items-center gap-1 text-sm hover:underline"
                            >
                              {row.sourceNumber}
                              <ExternalLink className="h-3 w-3" />
                            </Link>
                          ) : (
                            <span className="text-sm">{row.sourceNumber}</span>
                          )
                        ) : (
                          <Badge variant="muted" className="text-[10px]">
                            {SOURCE_LABEL[row.sourceType] ?? row.sourceType}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.debit > 0 ? formatMoney(row.debit, currency) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.credit > 0 ? formatMoney(row.credit, currency) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4}>Total</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(result?.totals.debit ?? 0, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(result?.totals.credit ?? 0, currency)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            {result && result.pagination.pages > 1 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= result.pagination.pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </>
            )}
          </div>
          <div className="flex gap-2">
            {result && (
              <Button asChild variant="outline" size="sm">
                <Link to={`/accounting/ledger/${result.account._id}`}>
                  Open full ledger
                </Link>
              </Button>
            )}
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
