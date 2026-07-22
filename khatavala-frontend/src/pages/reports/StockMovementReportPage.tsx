import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { FilterBar } from '@/components/reports/FilterBar';
import { formatDate } from '@/lib/utils';
import * as opReportsService from '@/services/operationalReports.service';

export function StockMovementReportPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<{ from?: string; to?: string; search?: string }>({});

  const loadData = async (query: { from?: string; to?: string; search?: string }) => {
    setLoading(true);
    try {
      const res = await opReportsService.getStockMovementReport(query);
      setItems(res.items);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(filters);
  }, [filters]);

  const filteredItems = items.filter((i) =>
    filters.search
      ? i.productName.toLowerCase().includes(filters.search.toLowerCase()) ||
        i.sku.toLowerCase().includes(filters.search.toLowerCase()) ||
        i.referenceType.toLowerCase().includes(filters.search.toLowerCase())
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
          <h1 className="text-2xl font-bold tracking-tight">Stock Movement Ledger</h1>
          <p className="text-sm text-muted-foreground">Audit log of all stock increases, deductions, transfers, and adjustments.</p>
        </div>
      </div>

      <FilterBar onFilterChange={setFilters} loading={loading} />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Movement Type</TableHead>
                <TableHead>Source Event</TableHead>
                <TableHead className="text-right">Qty Delta</TableHead>
                <TableHead className="text-right">Running Stock</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading stock movements…
                  </TableCell>
                </TableRow>
              ) : filteredItems.length > 0 ? (
                filteredItems.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>{formatDate(m.date)}</TableCell>
                    <TableCell className="font-semibold">{m.productName}</TableCell>
                    <TableCell className="font-mono text-xs">{m.sku || '—'}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          m.movementType === 'In'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 font-semibold'
                            : m.movementType === 'Out'
                            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 font-semibold'
                            : 'font-semibold'
                        }
                      >
                        {m.movementType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{m.referenceType}</TableCell>
                    <TableCell className={`text-right font-mono font-bold ${m.quantity >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {m.quantity >= 0 ? `+${m.quantity}` : m.quantity}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold">{m.runningBalance}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No stock movements recorded for the selected filter.
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
