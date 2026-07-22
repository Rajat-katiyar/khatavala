import { useEffect, useState } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as opReportsService from '@/services/operationalReports.service';

export function InventoryValuationPage() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [items, setItems] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    opReportsService
      .getInventoryValuationReport()
      .then((res) => {
        setItems(res.items);
        setSummary(res.summary);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/reports">
              <ArrowLeft className="mr-2 h-4 w-4" /> Reports Hub
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Inventory Valuation Report</h1>
          <p className="text-sm text-muted-foreground">
            Current stock quantities multiplied by purchase cost rates vs retail value.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => opReportsService.downloadReportExcel('valuation')}
          disabled={loading}
          className="gap-1.5"
        >
          <Download className="w-4 h-4 text-emerald-500" />
          Export Excel
        </Button>
      </div>

      {summary && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Total Products</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{summary.totalProducts}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">Total Units In Stock</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{summary.totalQuantity}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-amber-600">Cost Valuation</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-amber-600 dark:text-amber-400">
              {formatMoney(summary.totalValuationCost, currency)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-emerald-600">Retail Market Valuation</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatMoney(summary.totalValuationRetail, currency)}
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Product Name</TableHead>
                <TableHead className="text-right">Current Stock</TableHead>
                <TableHead className="text-right">Purchase Cost</TableHead>
                <TableHead className="text-right">Selling Price</TableHead>
                <TableHead className="text-right">Total Cost Value</TableHead>
                <TableHead className="text-right">Total Retail Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Calculating inventory valuation…
                  </TableCell>
                </TableRow>
              ) : items.length > 0 ? (
                items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs">{item.sku || '—'}</TableCell>
                    <TableCell className="font-semibold">{item.name}</TableCell>
                    <TableCell className="text-right font-medium">{item.currentStock}</TableCell>
                    <TableCell className="text-right">{formatMoney(item.purchasePrice, currency)}</TableCell>
                    <TableCell className="text-right">{formatMoney(item.sellingPrice, currency)}</TableCell>
                    <TableCell className="text-right font-semibold text-amber-600 dark:text-amber-400">
                      {formatMoney(item.totalCostValue, currency)}
                    </TableCell>
                    <TableCell className="text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatMoney(item.totalRetailValue, currency)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No active products found in inventory.
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
