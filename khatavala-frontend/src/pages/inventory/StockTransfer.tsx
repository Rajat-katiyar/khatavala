import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCompanyStore } from '@/store/companyStore';
import * as inventoryService from '@/services/inventory.service';
import type { Product, StockRow, Warehouse } from '@/types';
import { ProductPicker, WarehouseSelect, formatQty } from './InventoryParts';

/**
 * Move stock between two of the company's own warehouses.
 *
 * The server does this as one two-leg transaction, so the form does not need to
 * handle a half-completed transfer — either both legs land or neither does.
 * What the form DOES do is show the source balance before you commit, because
 * the alternative is discovering you only had 8 after typing 10 and reading a
 * rejection.
 */
export function StockTransfer() {
  const navigate = useNavigate();
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [stockRow, setStockRow] = useState<StockRow | null>(null);

  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [reason, setReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    inventoryService
      .listWarehouses()
      .then(setWarehouses)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load warehouses')
      );
  }, [tenantVersion]);

  // Pull the picked product's per-warehouse balances so the source dropdown can
  // show what is actually there.
  useEffect(() => {
    if (!product) {
      setStockRow(null);
      return;
    }
    inventoryService
      .getCurrentStock({ productId: product._id, includeZero: true })
      .then((stock) => setStockRow(stock.items[0] ?? null))
      .catch(() => setStockRow(null));
  }, [product]);

  const available = useMemo(() => {
    if (!stockRow || !fromWarehouseId) return null;
    return (
      stockRow.warehouses.find((w) => w.warehouseId === fromWarehouseId)?.quantity ?? 0
    );
  }, [stockRow, fromWarehouseId]);

  const quantityNumber = Number(quantity);
  const overAvailable =
    available !== null && quantityNumber > 0 && quantityNumber > available;

  const canSubmit =
    !!product &&
    !!fromWarehouseId &&
    !!toWarehouseId &&
    fromWarehouseId !== toWarehouseId &&
    quantityNumber > 0 &&
    !overAvailable &&
    !submitting;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !product) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await inventoryService.transferStock({
        productId: product._id,
        fromWarehouseId,
        toWarehouseId,
        quantity: quantityNumber,
        batchNumber: batchNumber.trim() || undefined,
        reason: reason.trim() || undefined,
      });
      setSuccess(
        `Moved ${formatQty(quantityNumber)} × ${product.name} to ${
          warehouses.find((w) => w._id === toWarehouseId)?.name ?? 'destination'
        }.`
      );
      setQuantity('');
      setBatchNumber('');
      setReason('');
      // Refresh the balances so a second transfer sees the new figures.
      const stock = await inventoryService.getCurrentStock({
        productId: product._id,
        includeZero: true,
      });
      setStockRow(stock.items[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Stock transfer</h1>
        <p className="text-sm text-muted-foreground">
          Move stock between warehouses. Both sides post as one entry — stock
          never leaves one place without arriving at the other.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transfer details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label>Product</Label>
              <ProductPicker value={product} onSelect={setProduct} disabled={submitting} />
              {stockRow && (
                <p className="text-xs text-muted-foreground">
                  On hand:{' '}
                  {stockRow.warehouses
                    .map(
                      (w) =>
                        `${warehouses.find((x) => x._id === w.warehouseId)?.name ?? '—'}: ${formatQty(w.quantity)}`
                    )
                    .join(' · ')}
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="from">From</Label>
                <WarehouseSelect
                  id="from"
                  required
                  warehouses={warehouses}
                  value={fromWarehouseId}
                  onChange={setFromWarehouseId}
                  placeholder="Select source"
                />
                {available !== null && (
                  <p className="text-xs text-muted-foreground">
                    {formatQty(available)} available here
                  </p>
                )}
              </div>
              <ArrowRight className="mx-auto mb-3 hidden h-4 w-4 text-muted-foreground sm:block" />
              <div className="space-y-2">
                <Label htmlFor="to">To</Label>
                <WarehouseSelect
                  id="to"
                  required
                  warehouses={warehouses.filter((w) => w._id !== fromWarehouseId)}
                  value={toWarehouseId}
                  onChange={setToWarehouseId}
                  placeholder="Select destination"
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  disabled={submitting}
                  required
                />
                {overAvailable && (
                  <p className="text-xs text-destructive">
                    Only {formatQty(available!)} available in the source warehouse.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch">Batch number (optional)</Label>
                <Input
                  id="batch"
                  value={batchNumber}
                  onChange={(e) => setBatchNumber(e.target.value)}
                  disabled={submitting}
                  placeholder="Leave blank if untracked"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Note (optional)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                placeholder="e.g. Restocking the shop counter"
              />
            </div>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                {success}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate('/inventory')}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Transfer stock
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {product && (
        <p className="text-sm text-muted-foreground">
          <Link className="underline" to={`/inventory/${product._id}/history`}>
            View movement history for {product.name}
          </Link>
        </p>
      )}
    </div>
  );
}
