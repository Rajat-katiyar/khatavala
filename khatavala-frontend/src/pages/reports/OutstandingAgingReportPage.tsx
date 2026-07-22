import { useEffect, useState } from 'react';
import { ArrowLeft, Download, Users, Truck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as opReportsService from '@/services/operationalReports.service';

export function OutstandingAgingReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const partyKind = (searchParams.get('type') as 'customer' | 'supplier') || 'customer';

  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    opReportsService
      .getOutstandingAgingReport(partyKind)
      .then((res) => {
        setRows(res.rows);
        setSummary(res.summary);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [partyKind]);

  const toggleKind = (kind: 'customer' | 'supplier') => {
    setSearchParams({ type: kind });
  };

  const chartData = rows.map((r) => ({
    name: r.partyName,
    '0-30 Days': r.bucket0_30,
    '31-60 Days': r.bucket31_60,
    '61-90 Days': r.bucket61_90,
    '90+ Days': r.bucket90Plus,
  }));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/reports">
              <ArrowLeft className="mr-2 h-4 w-4" /> Reports Hub
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">
            {partyKind === 'customer' ? 'Customer Receivables Aging' : 'Supplier Payables Aging'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Categorized overdue balance aging breakdown into 0-30, 31-60, 61-90, and 90+ day buckets.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 border p-1 rounded-lg bg-muted/40">
            <button
              onClick={() => toggleKind('customer')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                partyKind === 'customer' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Users className="w-3.5 h-3.5" /> Customers
            </button>
            <button
              onClick={() => toggleKind('supplier')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                partyKind === 'supplier' ? 'bg-primary text-primary-foreground shadow-xs' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Truck className="w-3.5 h-3.5" /> Suppliers
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => opReportsService.downloadReportExcel('aging', partyKind)}
            disabled={loading}
            className="gap-1.5 text-xs"
          >
            <Download className="w-3.5 h-3.5 text-emerald-500" /> Excel Export
          </Button>
        </div>
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-5">
          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Total Outstanding</CardTitle>
            </CardHeader>
            <CardContent className="text-xl font-bold text-primary">
              {formatMoney(summary.totalOutstanding, currency)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-emerald-600">0-30 Days</CardTitle>
            </CardHeader>
            <CardContent className="text-lg font-bold">{formatMoney(summary.total0_30, currency)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-amber-600">31-60 Days</CardTitle>
            </CardHeader>
            <CardContent className="text-lg font-bold">{formatMoney(summary.total31_60, currency)}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-orange-600">61-90 Days</CardTitle>
            </CardHeader>
            <CardContent className="text-lg font-bold">{formatMoney(summary.total61_90, currency)}</CardContent>
          </Card>
          <Card className="bg-rose-500/5 border-rose-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-rose-600">90+ Days</CardTitle>
            </CardHeader>
            <CardContent className="text-lg font-bold text-rose-600">
              {formatMoney(summary.total90Plus, currency)}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Stacked Bar Chart */}
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Aging Breakdown Visualizer</CardTitle>
            <CardDescription>Overdue bucket distribution per party</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: any) => formatMoney(Number(value || 0), currency)} />
                <Legend />
                <Bar dataKey="0-30 Days" stackId="a" fill="#10b981" />
                <Bar dataKey="31-60 Days" stackId="a" fill="#f59e0b" />
                <Bar dataKey="61-90 Days" stackId="a" fill="#f97316" />
                <Bar dataKey="90+ Days" stackId="a" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Aging Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{partyKind === 'customer' ? 'Customer Name' : 'Supplier Name'}</TableHead>
                <TableHead className="text-right font-bold text-primary">Total Outstanding</TableHead>
                <TableHead className="text-right text-emerald-600">0-30 Days</TableHead>
                <TableHead className="text-right text-amber-600">31-60 Days</TableHead>
                <TableHead className="text-right text-orange-600">61-90 Days</TableHead>
                <TableHead className="text-right text-rose-600">90+ Days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Calculating aging buckets…
                  </TableCell>
                </TableRow>
              ) : rows.length > 0 ? (
                rows.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-semibold">{row.partyName}</TableCell>
                    <TableCell className="text-right font-bold text-primary">
                      {formatMoney(row.totalOutstanding, currency)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-emerald-600">
                      {formatMoney(row.bucket0_30, currency)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-amber-600">
                      {formatMoney(row.bucket31_60, currency)}
                    </TableCell>
                    <TableCell className="text-right font-medium text-orange-600">
                      {formatMoney(row.bucket61_90, currency)}
                    </TableCell>
                    <TableCell className="text-right font-bold text-rose-600">
                      {formatMoney(row.bucket90Plus, currency)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No overdue outstanding balances found for {partyKind}s.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
