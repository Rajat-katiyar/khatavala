import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import * as gstService from '@/services/gst.service';
import type { GSTR3BSummary } from '@/types';

/**
 * GSTR-3B Report — Phase 14
 *
 * Summary return showing:
 *   3.1 — Outward taxable supplies (liability)
 *   4   — ITC available (from purchase invoices)
 *   Net tax payable = 3.1 − 4
 * Required for monthly GSTR-3B self-assessment filing.
 */

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function currentMonth() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function TaxRow({
  label,
  sub,
  igst,
  cgst,
  sgst,
  cess,
  currency,
  bold,
  highlight,
}: {
  label: string;
  sub?: string;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  currency: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <TableRow className={highlight ? 'bg-amber-50 dark:bg-amber-950/30' : ''}>
      <TableCell className={bold ? 'font-semibold' : ''}>
        {label}
        {sub && <span className="ml-1 text-xs text-muted-foreground">{sub}</span>}
      </TableCell>
      <TableCell className={`text-right tabular-nums ${bold ? 'font-semibold' : ''}`}>
        {igst > 0 ? formatMoney(igst, currency) : '—'}
      </TableCell>
      <TableCell className={`text-right tabular-nums ${bold ? 'font-semibold' : ''}`}>
        {cgst > 0 ? formatMoney(cgst, currency) : '—'}
      </TableCell>
      <TableCell className={`text-right tabular-nums ${bold ? 'font-semibold' : ''}`}>
        {sgst > 0 ? formatMoney(sgst, currency) : '—'}
      </TableCell>
      <TableCell className={`text-right tabular-nums ${bold ? 'font-semibold' : ''}`}>
        {cess > 0 ? formatMoney(cess, currency) : '—'}
      </TableCell>
    </TableRow>
  );
}

export function Gstr3bReport() {
  const currency = useCompanyStore((s) => s.activeCompany?.currency ?? 'INR');
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [month, setMonth] = useState(currentMonth().month);
  const [year, setYear] = useState(currentMonth().year);
  const [data, setData] = useState<GSTR3BSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await gstService.getGSTR3B({ month, year }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load GSTR-3B');
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { void load(); }, [load, tenantVersion]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await gstService.downloadGSTExport('gstr3b', { month, year });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">GSTR-3B — Summary Return</h1>
          <p className="text-sm text-muted-foreground">
            Outward tax liability vs Input Tax Credit (ITC). Net payable = Outward − ITC.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
          {exporting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileSpreadsheet className="mr-2 h-4 w-4" />
          )}
          Export Excel
        </Button>
      </div>

      {/* Period */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted-foreground">
          Month
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="mt-1 flex h-9 w-36 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          Year
          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            min={2020}
            max={2099}
            className="mt-1 w-24"
          />
        </label>
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
        </Button>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {/* Net payable hero card */}
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                3.1 Outward Tax Liability
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-2xl font-bold tabular-nums">
                {formatMoney(
                  data.outwardSupplies.igst + data.outwardSupplies.cgst +
                  data.outwardSupplies.sgst + data.outwardSupplies.cess,
                  currency
                )}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                4. ITC Available
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">
                {formatMoney(
                  data.itcAvailable.igst + data.itcAvailable.cgst +
                  data.itcAvailable.sgst + data.itcAvailable.cess,
                  currency
                )}
              </p>
            </CardContent>
          </Card>
          <Card className={data.netPayable.total > 0 ? 'border-amber-500' : 'border-green-500'}>
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Net Tax Payable
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className={`text-2xl font-bold tabular-nums ${data.netPayable.total > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                {formatMoney(data.netPayable.total, currency)}
              </p>
              {data.netPayable.total === 0 && (
                <p className="text-xs text-muted-foreground mt-1">ITC covers full liability</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Detail table */}
      <div className={loading ? 'opacity-60' : ''}>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/3">Section</TableHead>
                <TableHead className="text-right">IGST</TableHead>
                <TableHead className="text-right">CGST</TableHead>
                <TableHead className="text-right">SGST/UTGST</TableHead>
                <TableHead className="text-right">CESS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data ? (
                <>
                  <TaxRow
                    label="3.1 Outward Taxable Supplies"
                    sub="(other than nil rated, exempted)"
                    igst={data.outwardSupplies.igst}
                    cgst={data.outwardSupplies.cgst}
                    sgst={data.outwardSupplies.sgst}
                    cess={data.outwardSupplies.cess}
                    currency={currency}
                    bold
                  />
                  <TaxRow
                    label="4. ITC Available"
                    sub="(from purchase invoices)"
                    igst={data.itcAvailable.igst}
                    cgst={data.itcAvailable.cgst}
                    sgst={data.itcAvailable.sgst}
                    cess={data.itcAvailable.cess}
                    currency={currency}
                  />
                  <TaxRow
                    label="Net Tax Payable"
                    sub="(3.1 − 4)"
                    igst={data.netPayable.igst}
                    cgst={data.netPayable.cgst}
                    sgst={data.netPayable.sgst}
                    cess={data.netPayable.cess}
                    currency={currency}
                    bold
                    highlight
                  />
                </>
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {loading ? 'Loading…' : 'No data for this period.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {data && (
        <p className="text-xs text-muted-foreground">
          Period: {data.period} · ITC is assumed fully eligible. Verify with actual ITC
          reconciliation before filing.
        </p>
      )}
    </div>
  );
}
