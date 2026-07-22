import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useCompanyStore } from '@/store/companyStore';
import { cn, formatMoney, toLocalDateInput } from '@/lib/utils';
import * as reportsService from '@/services/reports.service';
import type { DayBookReport as Report, JournalSourceType } from '@/types';
import { ReportShell, periodLabel, useDebouncedRange, useReportRange } from './ReportShell';

/**
 * The day book: every entry for a day, in the order posted.
 *
 * Whole entries rather than a flat line list — a day book is read as a sequence
 * of transactions, and splitting an entry across rows loses the pairing that
 * makes each one legible. Each entry links to the document that caused it.
 */

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

export function DayBookReport() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currency = activeCompany?.currency ?? 'INR';

  // Defaults to today — the question a day book answers is "what happened
  // today?", and an empty date picker would answer "everything, ever".
  const today = toLocalDateInput();
  const [range, setRange] = useReportRange({ from: today, to: today });
  const debounced = useDebouncedRange(range);

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await reportsService.getDayBook({ date: debounced.from || undefined }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the day book');
    } finally {
      setLoading(false);
    }
  }, [debounced]);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  const subtitle = [activeCompany?.name, periodLabel(range, 'day')]
    .filter(Boolean)
    .join(' · ');

  return (
    <ReportShell
      title="Day Book"
      subtitle={subtitle}
      kind="day-book"
      range={range}
      onRangeChange={setRange}
      mode="day"
      balanced={report?.totals.balanced}
      loading={loading}
      error={error}
    >
      {loading && !report ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : report && report.entries.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          Nothing was posted on this day.
        </p>
      ) : (
        <div className="space-y-3">
          {report?.entries.map((entry) => {
            const path = SOURCE_PATH[entry.sourceType];
            return (
              <div
                key={entry._id}
                className={cn(
                  'rounded-md border p-3',
                  entry.reversedByEntryId && 'opacity-60'
                )}
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{entry.documentNumber}</span>
                    <Badge variant="muted" className="text-[10px]">
                      {SOURCE_LABEL[entry.sourceType] ?? entry.sourceType}
                    </Badge>
                    {entry.reversedByEntryId && (
                      <Badge variant="outline" className="text-[10px]">
                        Reversed
                      </Badge>
                    )}
                    {entry.sourceNumber &&
                      (path && entry.sourceId ? (
                        <Link
                          to={`${path}/${entry.sourceId}`}
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
                        >
                          {entry.sourceNumber}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          {entry.sourceNumber}
                        </span>
                      ))}
                  </div>
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {formatMoney(entry.totalDebit, currency)}
                  </span>
                </div>

                {entry.narration && (
                  <p className="mb-2 text-sm text-muted-foreground">{entry.narration}</p>
                )}

                <div className="space-y-0.5">
                  {entry.lines.map((line, index) => (
                    <div
                      key={line._id ?? index}
                      className="grid grid-cols-[1fr_110px_110px] gap-2 text-sm"
                    >
                      <Link
                        to={`/accounting/ledger/${line.accountId}`}
                        className="truncate hover:underline"
                      >
                        {/* Credits indented, as a T-account reads. */}
                        <span className={cn(line.creditAmount > 0 && 'pl-6')}>
                          {line.accountName}
                        </span>
                      </Link>
                      <span className="text-right tabular-nums">
                        {line.debitAmount > 0 ? formatMoney(line.debitAmount, currency) : ''}
                      </span>
                      <span className="text-right tabular-nums">
                        {line.creditAmount > 0
                          ? formatMoney(line.creditAmount, currency)
                          : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between border-t-2 border-foreground/30 px-3 py-2 font-semibold">
            <span>
              {report?.totals.entries} entr{report?.totals.entries === 1 ? 'y' : 'ies'}
            </span>
            <span className="flex gap-6 tabular-nums">
              <span>{formatMoney(report?.totals.debit ?? 0, currency)}</span>
              <span>{formatMoney(report?.totals.credit ?? 0, currency)}</span>
            </span>
          </div>
        </div>
      )}
    </ReportShell>
  );
}
