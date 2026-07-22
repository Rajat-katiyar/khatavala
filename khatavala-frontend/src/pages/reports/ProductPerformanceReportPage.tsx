import { useEffect, useState } from 'react';
import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FilterBar } from '@/components/reports/FilterBar';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as opReportsService from '@/services/operationalReports.service';

export function ProductPerformanceReportPage() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [topSellers, setTopSellers] = useState<any[]>([]);
  const [slowMovers, setSlowMovers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<{ from?: string; to?: string; search?: string }>({});

  const loadData = async (query: { from?: string; to?: string; search?: string }) => {
    setLoading(true);
    try {
      const res = await opReportsService.getProductPerformanceReport(query);
      setTopSellers(res.topSellers);
      setSlowMovers(res.slowMovers);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(filters);
  }, [filters]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/reports">
              <ArrowLeft className="mr-2 h-4 w-4" /> Reports Hub
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Product Performance Report</h1>
          <p className="text-sm text-muted-foreground">Best-selling products by revenue vs slow-moving inventory items.</p>
        </div>
      </div>

      <FilterBar onFilterChange={setFilters} loading={loading} />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Sellers */}
        <Card className="border-emerald-500/20">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-4 h-4" /> Top Selling Products
            </CardTitle>
            <CardDescription>Highest revenue generating catalog items</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Units Sold</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                      Analyzing performance…
                    </TableCell>
                  </TableRow>
                ) : topSellers.length > 0 ? (
                  topSellers.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <span className="font-semibold">{item.name}</span>
                        <p className="text-xs text-muted-foreground">SKU: {item.sku || '—'}</p>
                      </TableCell>
                      <TableCell className="text-right font-medium">{item.totalQuantity}</TableCell>
                      <TableCell className="text-right font-bold text-emerald-600">
                        {formatMoney(item.totalRevenue, currency)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                      No sales data available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Slow Movers */}
        <Card className="border-amber-500/20">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <TrendingDown className="w-4 h-4" /> Slow Moving Products
            </CardTitle>
            <CardDescription>Lowest volume or revenue contributing items</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Units Sold</TableHead>
                  <TableHead className="text-right">Total Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                      Analyzing performance…
                    </TableCell>
                  </TableRow>
                ) : slowMovers.length > 0 ? (
                  slowMovers.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <span className="font-semibold">{item.name}</span>
                        <p className="text-xs text-muted-foreground">SKU: {item.sku || '—'}</p>
                      </TableCell>
                      <TableCell className="text-right font-medium">{item.totalQuantity}</TableCell>
                      <TableCell className="text-right font-semibold text-foreground">
                        {formatMoney(item.totalRevenue, currency)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-6 text-muted-foreground">
                      No sales data available.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
