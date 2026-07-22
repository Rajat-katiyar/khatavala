import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeftRight, History, Loader2, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Can } from '@/components/Can';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as inventoryService from '@/services/inventory.service';
import type { CurrentStock } from '@/types';
import { LOW_STOCK_ROW, LOW_STOCK_TEXT, WarehouseSelect, formatQty } from './InventoryParts';

const PAGE_SIZE = 25;

export function InventoryList() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currency = activeCompany?.currency ?? 'INR';

  const [stock, setStock] = useState<CurrentStock | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced so typing a SKU is one request, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);
    try {
      setStock(
        await inventoryService.getCurrentStock({
          search: debouncedSearch || undefined,
          warehouseId: warehouseId || undefined,
          lowOnly: lowOnly || undefined,
          page,
          limit: PAGE_SIZE,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load stock');
    } finally {
      setLoading(false);
    }
  }, [activeCompany, debouncedSearch, warehouseId, lowOnly, page]);

  // tenantVersion is the refetch trigger: switching companies bumps it, which
  // re-runs this effect with the newly scoped access token in place.
  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  const warehouses = stock?.warehouses ?? [];
  const nameFor = (id: string) => warehouses.find((w) => w._id === id)?.name ?? 'Unknown';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Current stock on hand, by product and warehouse.
          </p>
        </div>
        <div className="flex gap-2">
          <Can permission="inventory.create">
            <Button asChild variant="outline" size="sm">
              <Link to="/inventory/transfer">
                <ArrowLeftRight className="mr-2 h-4 w-4" /> Transfer
              </Link>
            </Button>
          </Can>
          <Can permission="inventory.adjust">
            <Button asChild size="sm">
              <Link to="/inventory/adjustment">
                <SlidersHorizontal className="mr-2 h-4 w-4" /> Adjust
              </Link>
            </Button>
          </Can>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Products in stock" value={String(stock?.summary.products ?? 0)} />
        <SummaryCard
          label="Low stock"
          value={String(stock?.summary.lowStock ?? 0)}
          tone={stock && stock.summary.lowStock > 0 ? 'warning' : undefined}
        />
        <SummaryCard
          label="Stock value (at cost)"
          value={formatMoney(stock?.summary.stockValue ?? 0, currency)}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle>Stock on hand</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or SKU"
                className="w-52 pl-8"
              />
            </div>
            <div className="w-48">
              <WarehouseSelect
                warehouses={warehouses}
                value={warehouseId}
                onChange={(value) => {
                  setWarehouseId(value);
                  setPage(1);
                }}
              />
            </div>
            <Button
              variant={lowOnly ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                setLowOnly((v) => !v);
                setPage(1);
              }}
            >
              <AlertTriangle className="mr-2 h-4 w-4" /> Low stock
            </Button>
          </div>
        </CardHeader>

        <CardContent>
          {error && (
            <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {loading && !stock ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading stock…
            </p>
          ) : stock && stock.items.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              {lowOnly
                ? 'Nothing is below its reorder level.'
                : 'No stock yet. Record opening stock or receive a purchase to get started.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>By warehouse</TableHead>
                  <TableHead className="text-right">Reorder at</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock?.items.map((row) => (
                  <TableRow key={row.productId} className={row.isLowStock ? LOW_STOCK_ROW : ''}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {row.name}
                        {row.isLowStock && (
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${LOW_STOCK_TEXT} border-current`}
                          >
                            Low
                          </Badge>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.sku}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {/* The per-warehouse split is the point of the module —
                          "20 in hand" is useless when all 20 sit in the godown
                          and the counter has none. */}
                      {row.warehouses
                        .map((w) => `${nameFor(w.warehouseId)}: ${formatQty(w.quantity)}`)
                        .join(' · ')}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {row.minStockLevel > 0 ? formatQty(row.minStockLevel) : '—'}
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium ${row.isLowStock ? LOW_STOCK_TEXT : ''}`}
                    >
                      {formatQty(row.totalQuantity)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatMoney(row.stockValue, currency)}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="ghost" size="icon" title="Movement history">
                        <Link to={`/inventory/${row.productId}/history`}>
                          <History className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {stock && stock.pagination.pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {stock.pagination.page} of {stock.pagination.pages} ·{' '}
                {stock.pagination.total} products
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= stock.pagination.pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warning';
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={`mt-1 text-2xl font-semibold ${tone === 'warning' ? LOW_STOCK_TEXT : ''}`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
