import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilterBar } from '@/components/reports/FilterBar';
import { useCompanyStore } from '@/store/companyStore';
import { formatDate, formatMoney } from '@/lib/utils';
import * as opReportsService from '@/services/operationalReports.service';

export function SalesReportPage() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<{ from?: string; to?: string; search?: string }>({});

  const loadData = async (query: { from?: string; to?: string; search?: string }) => {
    setLoading(true);
    try {
      const res = await opReportsService.getSalesReport(query);
      setRows(res.rows);
      setSummary(res.summary);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(filters);
  }, [filters]);

  const filteredRows = rows.filter((r) =>
    filters.search
      ? r.invoiceNumber.toLowerCase().includes(filters.search.toLowerCase()) ||
        r.customerName.toLowerCase().includes(filters.search.toLowerCase())
      : true
  );

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/reports">
              <ArrowLeft className="mr-2 h-4 w-4" /> Reports Hub
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Sales Summary Report</h1>
          <p className="text-sm text-muted-foreground">Comprehensive record of posted sales invoices and tax liabilities.</p>
        </div>
      </div>

      <FilterBar
        onFilterChange={setFilters}
        onExportExcel={() => opReportsService.downloadReportExcel('sales')}
        loading={loading}
      />

      {summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Total Invoices</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{summary.count}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Total Revenue</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatMoney(summary.totalRevenue, currency)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Total GST Tax</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{formatMoney(summary.totalTax, currency)}</CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Taxable Value</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Grand Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading sales report…
                  </TableCell>
                </TableRow>
              ) : filteredRows.length > 0 ? (
                filteredRows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{formatDate(r.date)}</TableCell>
                    <TableCell className="font-semibold">{r.invoiceNumber}</TableCell>
                    <TableCell>{r.customerName}</TableCell>
                    <TableCell className="text-right">{formatMoney(r.taxableValue, currency)}</TableCell>
                    <TableCell className="text-right">{formatMoney(r.totalTax, currency)}</TableCell>
                    <TableCell className="text-right font-semibold">{formatMoney(r.grandTotal, currency)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No sales recorded for the selected period.
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
