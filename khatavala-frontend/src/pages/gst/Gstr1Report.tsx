import { useCallback, useEffect, useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import type { GSTR1Summary } from '@/types';

/**
 * GSTR-1 Report — Phase 14
 *
 * Shows outward supply summary in GSTR-1 format:
 *   - B2B: registered buyer invoices (have GSTIN)
 *   - B2C: unregistered consumer invoices
 * Required for monthly/quarterly GSTR-1 filing.
 */

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function currentMonth() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

type Tab = 'b2b' | 'b2c';

export function Gstr1Report() {
  const currency = useCompanyStore((s) => s.activeCompany?.currency ?? 'INR');
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [month, setMonth] = useState(currentMonth().month);
  const [year, setYear] = useState(currentMonth().year);
  const [data, setData] = useState<GSTR1Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState<Tab>('b2b');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await gstService.getGSTR1({ month, year }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load GSTR-1');
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { void load(); }, [load, tenantVersion]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await gstService.downloadGSTExport('gstr1', { month, year });
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
          <h1 className="text-2xl font-semibold">GSTR-1 — Outward Supplies</h1>
          <p className="text-sm text-muted-foreground">
            {data?.period && <span className="font-medium">{data.period}</span>}
            {' · '}
            {data?.totals.invoiceCount ?? 0} invoices
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

      {/* Totals summary cards */}
      {data && (
        <div className="grid gap-3 sm:grid-cols-5">
          {[
            { label: 'Taxable Value', value: data.totals.taxableValue },
            { label: 'IGST', value: data.totals.igst },
            { label: 'CGST', value: data.totals.cgst },
            { label: 'SGST', value: data.totals.sgst },
            { label: 'CESS', value: data.totals.cess },
          ].map((item) => (
            <Card key={item.label}>
              <CardHeader className="pb-1 pt-3">
                <CardTitle className="text-xs text-muted-foreground uppercase tracking-wider">
                  {item.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-3">
                <p className="text-lg font-bold tabular-nums">
                  {formatMoney(item.value, currency)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'b2b' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setTab('b2b')}
        >
          B2B Invoices
          {data && (
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {data.b2b.length}
            </Badge>
          )}
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'b2c' ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'}`}
          onClick={() => setTab('b2c')}
        >
          B2C Summary
          {data && (
            <Badge variant="secondary" className="ml-2 text-[10px]">
              {data.b2c.length}
            </Badge>
          )}
        </button>
      </div>

      <div className={loading ? 'opacity-60' : ''}>
        {tab === 'b2b' && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Legal Name</TableHead>
                  <TableHead>Invoice No.</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Invoice Value</TableHead>
                  <TableHead className="text-right w-12">POS</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST</TableHead>
                  <TableHead className="text-right">CESS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!data || data.b2b.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                      No B2B invoices in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.b2b.map((inv) => (
                    <TableRow key={inv.invoiceNumber}>
                      <TableCell className="font-mono text-xs">{inv.gstin}</TableCell>
                      <TableCell>{inv.partyName}</TableCell>
                      <TableCell className="font-mono text-xs">{inv.invoiceNumber}</TableCell>
                      <TableCell>{inv.invoiceDate}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(inv.invoiceValue, currency)}
                      </TableCell>
                      <TableCell className="text-right text-xs">{inv.placeOfSupply}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(inv.taxableValue, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inv.igst > 0 ? formatMoney(inv.igst, currency) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inv.cgst > 0 ? formatMoney(inv.cgst, currency) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inv.sgst > 0 ? formatMoney(inv.sgst, currency) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inv.cess > 0 ? formatMoney(inv.cess, currency) : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {data && data.b2b.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={6} className="font-semibold">TOTAL</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatMoney(data.b2b.reduce((s, r) => s + r.taxableValue, 0), currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatMoney(data.b2b.reduce((s, r) => s + r.igst, 0), currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatMoney(data.b2b.reduce((s, r) => s + r.cgst, 0), currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatMoney(data.b2b.reduce((s, r) => s + r.sgst, 0), currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      {formatMoney(data.b2b.reduce((s, r) => s + r.cess, 0), currency)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        )}

        {tab === 'b2c' && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supply Type</TableHead>
                  <TableHead className="text-right">Taxable Value</TableHead>
                  <TableHead className="text-right">IGST</TableHead>
                  <TableHead className="text-right">CGST</TableHead>
                  <TableHead className="text-right">SGST/UTGST</TableHead>
                  <TableHead className="text-right">CESS</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(!data || data.b2c.length === 0) ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      No B2C invoices in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  data.b2c.map((row) => (
                    <TableRow key={row.supplyType}>
                      <TableCell>
                        <Badge variant={row.supplyType === 'inter' ? 'default' : 'secondary'}>
                          {row.supplyType === 'inter' ? 'Inter-State' : 'Intra-State'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.taxableValue, currency)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.igst > 0 ? formatMoney(row.igst, currency) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.cgst > 0 ? formatMoney(row.cgst, currency) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.sgst > 0 ? formatMoney(row.sgst, currency) : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.cess > 0 ? formatMoney(row.cess, currency) : '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
