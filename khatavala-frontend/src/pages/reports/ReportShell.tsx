import { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Can } from '@/components/Can';
import { cn, toLocalDateInput } from '@/lib/utils';
import * as reportsService from '@/services/reports.service';
import type { ReportKind } from '@/services/reports.service';

/**
 * The frame every financial statement shares: title, date range, export
 * buttons, and the print styling.
 *
 * PRINTING is a first-class output here, not an afterthought — an accountant
 * prints a trial balance far more often than they screenshot one. The
 * `@media print` block strips the app chrome and the controls, so what comes
 * out of the printer is the statement alone on white, which is also why the
 * report bodies use plain tables rather than cards.
 */

export interface DateRange {
  from: string;
  to: string;
}

/** Quick ranges, because nobody wants to type "1 April" every morning. */
function presets(): { label: string; range: DateRange }[] {
  const today = new Date();
  // Local, not UTC — see toLocalDateInput.
  const iso = toLocalDateInput;

  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

  // The Indian financial year starts 1 April; a January date belongs to the
  // year that began the previous April.
  const fyStartYear = today.getMonth() + 1 >= 4 ? today.getFullYear() : today.getFullYear() - 1;

  return [
    { label: 'This month', range: { from: iso(startOfMonth), to: iso(today) } },
    {
      label: 'Last month',
      range: { from: iso(startOfLastMonth), to: iso(endOfLastMonth) },
    },
    {
      label: 'This financial year',
      range: { from: `${fyStartYear}-04-01`, to: iso(today) },
    },
    { label: 'All time', range: { from: '', to: '' } },
  ];
}

export function DateRangePicker({
  value,
  onChange,
  mode = 'range',
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** `asOf` reports (the balance sheet) take a single date. */
  mode?: 'range' | 'asOf' | 'day';
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 print:hidden">
      {mode === 'range' && (
        <>
          <label className="text-xs text-muted-foreground">
            From
            <Input
              type="date"
              value={value.from}
              onChange={(e) => onChange({ ...value, from: e.target.value })}
              className="mt-1 w-36"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            To
            <Input
              type="date"
              value={value.to}
              onChange={(e) => onChange({ ...value, to: e.target.value })}
              className="mt-1 w-36"
            />
          </label>
          <div className="flex gap-1">
            {presets().map((preset) => (
              <Button
                key={preset.label}
                variant="outline"
                size="sm"
                onClick={() => onChange(preset.range)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </>
      )}

      {mode === 'asOf' && (
        <label className="text-xs text-muted-foreground">
          As at
          <Input
            type="date"
            value={value.to}
            onChange={(e) => onChange({ from: '', to: e.target.value })}
            className="mt-1 w-40"
          />
        </label>
      )}

      {mode === 'day' && (
        <label className="text-xs text-muted-foreground">
          Date
          <Input
            type="date"
            value={value.from}
            onChange={(e) => onChange({ from: e.target.value, to: e.target.value })}
            className="mt-1 w-40"
          />
        </label>
      )}
    </div>
  );
}

export function ReportShell({
  title,
  subtitle,
  kind,
  range,
  onRangeChange,
  mode = 'range',
  balanced,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  kind: ReportKind;
  range: DateRange;
  onRangeChange: (range: DateRange) => void;
  mode?: 'range' | 'asOf' | 'day';
  /** When present, renders the balance check badge. */
  balanced?: boolean;
  loading?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const exportAs = async (format: 'pdf' | 'xlsx') => {
    setExporting(format);
    setExportError(null);
    try {
      await reportsService.downloadReport(kind, format, {
        from: range.from || undefined,
        to: range.to || undefined,
        ...(mode === 'day' && range.from ? { date: range.from } : {}),
      });
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-5">
      <style>{`
        @media print {
          /* Hide the app shell and leave the statement alone on the page. */
          header, nav, .print\\:hidden { display: none !important; }
          main { padding: 0 !important; }
          body { background: #fff !important; }
          #report-body { font-size: 11px; }
          #report-body table { page-break-inside: auto; }
          #report-body tr { page-break-inside: avoid; page-break-after: auto; }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{title}</h1>
            {balanced !== undefined && (
              <Badge
                variant={balanced ? 'secondary' : 'destructive'}
                className="text-[10px]"
              >
                {balanced ? 'Balanced' : 'OUT OF BALANCE'}
              </Badge>
            )}
          </div>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        <div className="flex gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
          <Can permission="reports.export">
            <Button
              variant="outline"
              size="sm"
              disabled={exporting !== null}
              onClick={() => exportAs('pdf')}
            >
              {exporting === 'pdf' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              PDF
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={exporting !== null}
              onClick={() => exportAs('xlsx')}
            >
              {exporting === 'xlsx' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="mr-2 h-4 w-4" />
              )}
              Excel
            </Button>
          </Can>
        </div>
      </div>

      <DateRangePicker value={range} onChange={onRangeChange} mode={mode} />

      {(error || exportError) && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive print:hidden">
          {error ?? exportError}
        </p>
      )}

      <div id="report-body" className={cn(loading && 'opacity-60')}>
        {children}
      </div>
    </div>
  );
}

/** Shared row styling, so all four statements read as one family. */
export const REPORT_ROW = 'border-b last:border-0';
export const REPORT_TOTAL = 'border-t-2 border-foreground/30 font-semibold';

export function useReportRange(initial?: Partial<DateRange>) {
  const [range, setRange] = useState<DateRange>({
    from: initial?.from ?? '',
    to: initial?.to ?? '',
  });
  return [range, setRange] as const;
}

/** Formats the period the way the printed statements label it. */
export function periodLabel(range: DateRange, mode: 'range' | 'asOf' | 'day') {
  const pretty = (value: string) =>
    new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(new Date(value));

  if (mode === 'asOf') return range.to ? `As at ${pretty(range.to)}` : 'As at today';
  if (mode === 'day') return range.from ? pretty(range.from) : 'Today';
  if (range.from && range.to) return `${pretty(range.from)} to ${pretty(range.to)}`;
  if (range.from) return `From ${pretty(range.from)}`;
  if (range.to) return `Up to ${pretty(range.to)}`;
  return 'All time';
}

/** Keeps the effect deps honest without re-running on every keystroke. */
export function useDebouncedRange(range: DateRange, delay = 250) {
  const [debounced, setDebounced] = useState(range);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(range), delay);
    return () => clearTimeout(timer);
  }, [range, delay]);
  return debounced;
}
