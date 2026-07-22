import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useCompanyStore } from '@/store/companyStore';
import { cn, formatMoney } from '@/lib/utils';
import * as reportsService from '@/services/reports.service';
import type { BalanceSheetReport as Report, DrillDownKey, ReportLine } from '@/types';
import { ReportShell, periodLabel, useDebouncedRange, useReportRange } from './ReportShell';
import { DrillDownPanel } from './DrillDownPanel';

/**
 * The balance sheet as at a date.
 *
 * Retained earnings is shown as an equity line with no ledger behind it — it is
 * computed as profit to date, which is why it carries a note instead of a
 * drill-down. That figure is also the reconciliation this phase exists to
 * demonstrate: it equals the P&L net profit for the same period, by
 * construction rather than by agreement.
 */
export function BalanceSheetReport() {
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
      setReport(await reportsService.getBalanceSheet(debounced.to || undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the balance sheet');
    } finally {
      setLoading(false);
    }
  }, [debounced]);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  const Line = ({ line }: { line: ReportLine }) => (
    <button
      type="button"
      className="flex w-full items-center justify-between py-1.5 pl-6 pr-2 text-sm hover:bg-accent/50"
      onClick={() => setDrill({ ...line.drillDown, label: line.accountName })}
    >
      <span className="hover:underline">{line.accountName}</span>
      <span className={cn('tabular-nums', line.amount < 0 && 'text-destructive')}>
        {formatMoney(line.amount, currency)}
      </span>
    </button>
  );

  const Section = ({
    title,
    lines,
    totalLabel,
    total,
    extra,
  }: {
    title: string;
    lines: ReportLine[];
    totalLabel: string;
    total: number;
    extra?: React.ReactNode;
  }) => (
    <div className="mb-5">
      <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {lines.length === 0 && !extra && (
        <p className="px-6 py-1.5 text-sm text-muted-foreground">None</p>
      )}
      {lines.map((line) => (
        <Line key={line.accountId} line={line} />
      ))}
      {extra}
      <div className="mt-1 flex items-center justify-between border-t px-2 py-1.5 text-sm font-semibold">
        <span>{totalLabel}</span>
        <span className="tabular-nums">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );

  const subtitle = [activeCompany?.name, periodLabel(range, 'asOf')]
    .filter(Boolean)
    .join(' · ');

  return (
    <ReportShell
      title="Balance Sheet"
      subtitle={subtitle}
      kind="balance-sheet"
      range={range}
      onRangeChange={setRange}
      mode="asOf"
      balanced={report?.totals.balanced}
      loading={loading}
      error={error}
    >
      {loading && !report ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        report && (
          <div className="mx-auto max-w-2xl">
            <Section
              title="Assets"
              lines={report.sections.assets.lines}
              totalLabel="Total assets"
              total={report.totals.assets}
            />
            <Section
              title="Liabilities"
              lines={report.sections.liabilities.lines}
              totalLabel="Total liabilities"
              total={report.totals.liabilities}
            />
            <Section
              title="Equity"
              lines={report.sections.equity.lines}
              totalLabel="Total equity"
              total={report.totals.equity}
              extra={
                <div className="flex w-full items-center justify-between py-1.5 pl-6 pr-2 text-sm">
                  <span className="flex items-center gap-2">
                    {report.sections.equity.retainedEarnings.accountName}
                    <Badge variant="muted" className="text-[10px]">
                      computed
                    </Badge>
                  </span>
                  <span
                    className={cn(
                      'tabular-nums',
                      report.sections.equity.retainedEarnings.amount < 0 && 'text-destructive'
                    )}
                  >
                    {formatMoney(report.sections.equity.retainedEarnings.amount, currency)}
                  </span>
                </div>
              }
            />

            <div
              className={cn(
                'flex items-center justify-between border-t-2 border-foreground/30 px-2 py-2 text-base font-semibold',
                !report.totals.balanced && 'text-destructive'
              )}
            >
              <span>Total liabilities and equity</span>
              <span className="tabular-nums">
                {formatMoney(report.totals.liabilitiesAndEquity, currency)}
              </span>
            </div>

            <p className="px-2 pt-4 text-xs text-muted-foreground">
              Retained earnings is income of{' '}
              {formatMoney(report.sections.equity.retainedEarnings.breakdown.income, currency)}{' '}
              less expenses of{' '}
              {formatMoney(report.sections.equity.retainedEarnings.breakdown.expenses, currency)}
              . It is computed from the same journal entries as the profit &amp; loss
              statement, so the two always agree.
            </p>
          </div>
        )
      )}

      <DrillDownPanel drillDown={drill} label={drill?.label} onClose={() => setDrill(null)} />
    </ReportShell>
  );
}
