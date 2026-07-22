import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanyStore } from '@/store/companyStore';
import { formatDate } from '@/lib/utils';
import * as inventoryService from '@/services/inventory.service';
import * as productService from '@/services/product.service';
import type { MovementHistory, MovementType, Product, StockRow, Warehouse } from '@/types';
import {
  LOW_STOCK_TEXT,
  MovementBadge,
  WarehouseSelect,
  formatQty,
} from './InventoryParts';

const PAGE_SIZE = 50;
const MOVEMENT_TYPES: MovementType[] = ['In', 'Out', 'Transfer', 'Adjustment', 'Damage'];

/**
 * The full movement ledger for one product.
 *
 * The signed `quantity` the API returns is split back into In and Out columns
 * here — a storekeeper reads two columns, not a minus sign. `runningBalance` is
 * shown as stored rather than recomputed in the browser: it is the balance as
 * it stood at that moment, which is the whole reason it is denormalised, and
 * re-deriving it client-side from a PAGE of entries would produce a different
 * (wrong) number on every page but the first.
 *
 * Note the balance column is per product+warehouse+batch, so on an unfiltered
 * view consecutive rows can belong to different warehouses and the column will
 * not read as a single descending sequence. Filter by warehouse to follow one.
 */
export function ProductHistory() {
  const { productId = '' } = useParams();
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [product, setProduct] = useState<Product | null>(null);
  const [stockRow, setStockRow] = useState<StockRow | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [history, setHistory] = useState<MovementHistory | null>(null);

  const [warehouseId, setWarehouseId] = useState('');
  const [movementType, setMovementType] = useState<MovementType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) return;
    Promise.all([
      productService.getProduct(productId),
      inventoryService.listWarehouses(true),
      inventoryService.getCurrentStock({ productId, includeZero: true }),
    ])
      .then(([fetchedProduct, fetchedWarehouses, stock]) => {
        setProduct(fetchedProduct);
        setWarehouses(fetchedWarehouses);
        setStockRow(stock.items[0] ?? null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load the product')
      );
  }, [productId, tenantVersion]);

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      setHistory(
        await inventoryService.getMovementHistory({
          productId,
          warehouseId: warehouseId || undefined,
          movementType: movementType || undefined,
          from: from || undefined,
          // A date input gives midnight; without this an end date of "today"
          // would exclude everything posted today.
          to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
          page,
          limit: PAGE_SIZE,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load movements');
    } finally {
      setLoading(false);
    }
  }, [productId, warehouseId, movementType, from, to, page]);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  const warehouseName = (id: string) =>
    warehouses.find((w) => w._id === id)?.name ?? 'Unknown';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/inventory">
              <ArrowLeft className="mr-2 h-4 w-4" /> Inventory
            </Link>
          </Button>
          <h1 className="text-2xl font-semibold">
            {product ? product.name : 'Movement history'}
          </h1>
          {product && (
            <p className="text-sm text-muted-foreground">
              SKU {product.sku}
              {stockRow && (
                <>
                  {' · '}
                  <span className={stockRow.isLowStock ? LOW_STOCK_TEXT : ''}>
                    {formatQty(stockRow.totalQuantity)} on hand
                  </span>
                  {stockRow.warehouses.length > 0 && (
                    <>
                      {' ('}
                      {stockRow.warehouses
                        .map(
                          (w) => `${warehouseName(w.warehouseId)}: ${formatQty(w.quantity)}`
                        )
                        .join(', ')}
                      {')'}
                    </>
                  )}
                </>
              )}
            </p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="warehouse">Warehouse</Label>
              <WarehouseSelect
                id="warehouse"
                warehouses={warehouses}
                value={warehouseId}
                onChange={(value) => {
                  setWarehouseId(value);
                  setPage(1);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Movement type</Label>
              <select
                id="type"
                value={movementType}
                onChange={(e) => {
                  setMovementType(e.target.value as MovementType | '');
                  setPage(1);
                }}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">All types</option>
                {MOVEMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="from">From</Label>
              <Input
                id="from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="to">To</Label>
              <Input
                id="to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Movements</CardTitle>
          {history && (
            <span className="text-sm text-muted-foreground">
              {history.pagination.total} entries
            </span>
          )}
        </CardHeader>
        <CardContent>
          {error && (
            <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {loading && !history ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading movements…
            </p>
          ) : history && history.entries.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              No movements match these filters.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead className="w-28">Type</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Batch</TableHead>
                  <TableHead>Reason / reference</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history?.entries.map((entry) => {
                  const warehouse =
                    typeof entry.warehouseId === 'string'
                      ? warehouseName(entry.warehouseId)
                      : entry.warehouseId.name;
                  return (
                    <TableRow key={entry._id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(entry.timestamp)}
                      </TableCell>
                      <TableCell>
                        <MovementBadge type={entry.movementType} />
                      </TableCell>
                      <TableCell>{warehouse}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {entry.batchNumber || '—'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {entry.reason || entry.referenceType}
                      </TableCell>
                      <TableCell className="text-right text-emerald-700 dark:text-emerald-400">
                        {entry.quantity > 0 ? formatQty(entry.quantity) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-destructive">
                        {entry.quantity < 0 ? formatQty(-entry.quantity) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatQty(entry.runningBalance)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {history && history.pagination.pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {history.pagination.page} of {history.pagination.pages}
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
                  disabled={page >= history.pagination.pages || loading}
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
