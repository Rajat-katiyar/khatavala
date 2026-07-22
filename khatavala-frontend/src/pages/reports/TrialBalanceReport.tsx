import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
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
import { cn, formatMoney } from '@/lib/utils';
import * as reportsService from '@/services/reports.service';
import type { DrillDownKey, TrialBalanceReport as Report } from '@/types';
import { ReportShell, periodLabel, useDebouncedRange, useReportRange } from './ReportShell';
import { DrillDownPanel } from './DrillDownPanel';

/**
 * The trial balance — every account with movement, and the proof the books
 * balance. If the badge ever reads OUT OF BALANCE, something bypassed the
 * journal service and every other statement is suspect.
 */
export function TrialBalanceReport() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currency = activeCompany?.currency ?? 'INR';

  const [range, setRange] = useReportRange();
  const debounced = useDebouncedRange(range);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<(DrillDownKey & { label?: string }) | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(
        await reportsService.getTrialBalance({
          from: debounced.from || undefined,
          to: debounced.to || undefined,
        })
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the trial balance');
    } finally {
      setLoading(false);
    }
  }, [debounced]);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  const subtitle = [activeCompany?.name, periodLabel(range, 'range')]
    .filter(Boolean)
    .join(' · ');

  return (
    <ReportShell
      title="Trial Balance"
      subtitle={subtitle}
      kind="trial-balance"
      range={range}
      onRangeChange={setRange}
      balanced={report?.totals.balanced}
      loading={loading}
      error={error}
    >
      {loading && !report ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : report && report.accounts.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">Nothing posted in this period.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">Code</TableHead>
              <TableHead>Account</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead className="w-32 text-right">Debit</TableHead>
              <TableHead className="w-32 text-right">Credit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {report?.accounts.map((account) => (
              <TableRow
                key={account.accountId}
                className="cursor-pointer"
                onClick={() => setDrill({ ...account.drillDown, label: account.accountName })}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {account.code ?? ''}
                </TableCell>
                <TableCell className="hover:underline">{account.accountName}</TableCell>
                <TableCell className="text-muted-foreground">{account.accountType}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {account.debit > 0 ? formatMoney(account.debit, currency) : '—'}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {account.credit > 0 ? formatMoney(account.credit, currency) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className={cn(!report?.totals.balanced && 'text-destructive')}>
              <TableCell colSpan={3}>TOTAL</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(report?.totals.debit ?? 0, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(report?.totals.credit ?? 0, currency)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}

      <DrillDownPanel drillDown={drill} label={drill?.label} onClose={() => setDrill(null)} />
    </ReportShell>
  );
}
