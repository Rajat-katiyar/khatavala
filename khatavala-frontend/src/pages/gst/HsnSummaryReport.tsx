import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatMoney } from '@/lib/utils';
import { useCompanyStore } from '@/store/companyStore';
import * as gstService from '@/services/gst.service';
import type { HSNSummaryRow } from '@/types';

/**
 * HSN Summary Report — Phase 14
 *
 * Groups all posted sales invoice line items by HSN/SAC code and shows:
 * taxable value, CGST, SGST, IGST, CESS, and total tax per code.
 * Required for Table 12 of GSTR-1 and annual HSN summary.
 */

function currentMonth() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export function HsnSummaryReport() {
  const currency = useCompanyStore((s) => s.activeCompany?.currency ?? 'INR');
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [month, setMonth] = useState(currentMonth().month);
  const [year, setYear] = useState(currentMonth().year);
  const [rows, setRows] = useState<HSNSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await gstService.getHSNSummary({ month, year });
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load HSN summary');
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await gstService.downloadGSTExport('hsn-summary', { month, year });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const totals = {
    taxableValue: rows.reduce((s, r) => s + r.taxableValue, 0),
    integratedTax: rows.reduce((s, r) => s + r.integratedTax, 0),
    centralTax: rows.reduce((s, r) => s + r.centralTax, 0),
    stateTax: rows.reduce((s, r) => s + r.stateTax, 0),
    cess: rows.reduce((s, r) => s + r.cess, 0),
    totalTax: rows.reduce((s, r) => s + r.totalTax, 0),
  };

  const MONTHS = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">HSN / SAC Summary</h1>
          <p className="text-sm text-muted-foreground">
            Taxable value and tax breakup grouped by HSN code — required for GSTR-1 Table 12.
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

      {/* Period selector */}
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

      {/* Summary cards */}
      {rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Total Taxable Value
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-xl font-bold tabular-nums">
                {formatMoney(totals.taxableValue, currency)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                CGST + SGST
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-xl font-bold tabular-nums">
                {formatMoney(totals.centralTax + totals.stateTax, currency)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-4">
              <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Total Tax
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <p className="text-xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {formatMoney(totals.totalTax, currency)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <div className={loading ? 'opacity-60' : ''}>
        {!loading && rows.length === 0 ? (
          <p className="py-8 text-sm text-muted-foreground">
            No posted invoices in {MONTHS[month - 1]} {year}.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>HSN / SAC</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right w-20">UQC</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Taxable Value</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST/UTGST</TableHead>
                  <TableHead className="text-right">CESS</TableHead>
                  <TableHead className="text-right">Total Tax</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.hsnCode}>
                    <TableCell className="font-mono font-medium">{row.hsnCode}</TableCell>
                    <TableCell className="text-muted-foreground max-w-[200px] truncate">
                      {row.description || '—'}
                    </TableCell>
                    <TableCell className="text-right">{row.uqc}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.totalQuantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.taxableValue, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.integratedTax > 0 ? formatMoney(row.integratedTax, currency) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.centralTax > 0 ? formatMoney(row.centralTax, currency) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.stateTax > 0 ? formatMoney(row.stateTax, currency) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.cess > 0 ? formatMoney(row.cess, currency) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {formatMoney(row.totalTax, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={4} className="font-semibold">
                    TOTAL
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatMoney(totals.taxableValue, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatMoney(totals.integratedTax, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatMoney(totals.centralTax, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatMoney(totals.stateTax, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatMoney(totals.cess, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {formatMoney(totals.totalTax, currency)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
