import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useCompanyStore } from '@/store/companyStore';
import { cn, formatMoney } from '@/lib/utils';
import * as reportsService from '@/services/reports.service';
import type { DrillDownKey, ProfitAndLossReport as Report, ReportLine } from '@/types';
import { ReportShell, periodLabel, useDebouncedRange, useReportRange } from './ReportShell';
import { DrillDownPanel } from './DrillDownPanel';

/**
 * Profit & loss, laid out as a statement rather than a table: sections with
 * indented lines and a rule above each subtotal, which is how an accountant
 * reads one.
 *
 * Sales returns appear as a deduction WITHIN revenue, and purchase returns
 * within cost of sales — see reports.service on why grouping purely by account
 * type would misfile both.
 */
export function ProfitLossReport() {
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
        await reportsService.getProfitAndLoss({
          from: debounced.from || undefined,
          to: debounced.to || undefined,
        })
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the statement');
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
      <span className="tabular-nums">{formatMoney(line.amount, currency)}</span>
    </button>
  );

  const Section = ({
    title,
    lines,
    totalLabel,
    total,
  }: {
    title: string;
    lines: ReportLine[];
    totalLabel: string;
    total: number;
  }) =>
    // A section with no movement is omitted entirely rather than printed as a
    // row of zeros — a statement should only assert what happened.
    lines.length === 0 ? null : (
      <div className="mb-4">
        <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {lines.map((line) => (
          <Line key={line.accountId} line={line} />
        ))}
        <div className="mt-1 flex items-center justify-between border-t px-2 py-1.5 text-sm font-medium">
          <span>{totalLabel}</span>
          <span className="tabular-nums">{formatMoney(total, currency)}</span>
        </div>
      </div>
    );

  const Headline = ({ label, amount }: { label: string; amount: number }) => (
    <div
      className={cn(
        'flex items-center justify-between border-t-2 border-foreground/30 px-2 py-2 text-base font-semibold',
        amount < 0 && 'text-destructive'
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums">{formatMoney(amount, currency)}</span>
    </div>
  );

  const subtitle = [activeCompany?.name, periodLabel(range, 'range')]
    .filter(Boolean)
    .join(' · ');

  return (
    <ReportShell
      title="Profit & Loss"
      subtitle={subtitle}
      kind="profit-loss"
      range={range}
      onRangeChange={setRange}
      loading={loading}
      error={error}
    >
      {loading && !report ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        report && (
          <>
            <div className="mb-5 grid gap-4 sm:grid-cols-3 print:hidden">
              <Metric
                label="Net revenue"
                value={formatMoney(report.totals.netRevenue, currency)}
              />
              <Metric
                label="Gross profit"
                value={formatMoney(report.totals.grossProfit, currency)}
                sub={
                  report.totals.grossMarginPercent === null
                    ? undefined
                    : `${report.totals.grossMarginPercent}% margin`
                }
                negative={report.totals.grossProfit < 0}
              />
              <Metric
                label="Net profit"
                value={formatMoney(report.totals.netProfit, currency)}
                sub={
                  report.totals.netMarginPercent === null
                    ? undefined
                    : `${report.totals.netMarginPercent}% margin`
                }
                negative={report.totals.netProfit < 0}
              />
            </div>

            <div className="mx-auto max-w-2xl">
              <Section
                title="Revenue"
                lines={report.sections.revenue.lines}
                totalLabel="Net revenue"
                total={report.totals.netRevenue}
              />
              <Section
                title="Cost of sales"
                lines={report.sections.costOfSales.lines}
                totalLabel="Total cost of sales"
                total={report.totals.costOfSales}
              />
              <Headline label="Gross profit" amount={report.totals.grossProfit} />
              <div className="h-4" />
              <Section
                title="Other income"
                lines={report.sections.otherIncome.lines}
                totalLabel="Total other income"
                total={report.totals.otherIncome}
              />
              <Section
                title="Expenses"
                lines={report.sections.expenses.lines}
                totalLabel="Total expenses"
                total={report.totals.expenses}
              />
              <Headline label="Net profit" amount={report.totals.netProfit} />
            </div>
          </>
        )
      )}

      <DrillDownPanel drillDown={drill} label={drill?.label} onClose={() => setDrill(null)} />
    </ReportShell>
  );
}

function Metric({
  label,
  value,
  sub,
  negative,
}: {
  label: string;
  value: string;
  sub?: string;
  negative?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={cn(
            'mt-1 text-2xl font-semibold tabular-nums',
            negative && 'text-destructive'
          )}
        >
          {value}
        </p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
