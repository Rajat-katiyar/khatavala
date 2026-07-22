import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCompanyStore } from '@/store/companyStore';
import { cn } from '@/lib/utils';
import * as inventoryService from '@/services/inventory.service';
import type { Product, StockRow, Warehouse } from '@/types';
import { ProductPicker, WarehouseSelect, formatQty } from './InventoryParts';

/**
 * Adjustments and damage write-offs.
 *
 * These are the two ways stock changes without a sale or a purchase, so they
 * are also the two an auditor looks at first — which is why `reason` is
 * required by the form, by the API and by the service. They share a screen
 * because the inputs are identical, but they post to different endpoints and
 * land in the ledger as different movement types: "the count was wrong" and
 * "we lost this" are different facts, and merging them makes wastage
 * unreportable.
 */

type Mode = 'adjustment' | 'damage';

/** Suggestions, not a fixed list — the field stays free text. */
const REASONS: Record<Mode, string[]> = {
  adjustment: [
    'Physical stock count correction',
    'Data entry error',
    'Found misplaced stock',
    'Opening balance correction',
  ],
  damage: [
    'Damaged in storage',
    'Damaged in transit',
    'Expired',
    'Spillage / breakage',
    'Theft / shrinkage',
  ],
};

export function StockAdjustment() {
  const navigate = useNavigate();
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [mode, setMode] = useState<Mode>('adjustment');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [stockRow, setStockRow] = useState<StockRow | null>(null);

  const [warehouseId, setWarehouseId] = useState('');
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase');
  const [quantity, setQuantity] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [reason, setReason] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    inventoryService
      .listWarehouses()
      .then((list) => {
        setWarehouses(list);
        // Preselect the default warehouse — it is the right answer most of the
        // time and saves a click on the most-used screen in the module.
        setWarehouseId((current) => current || list.find((w) => w.isDefault)?._id || '');
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Could not load warehouses')
      );
  }, [tenantVersion]);

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
    if (!stockRow || !warehouseId) return null;
    return stockRow.warehouses.find((w) => w.warehouseId === warehouseId)?.quantity ?? 0;
  }, [stockRow, warehouseId]);

  const quantityNumber = Number(quantity);
  // Damage is always a write-off; an adjustment can go either way.
  const removing = mode === 'damage' || direction === 'decrease';
  const overAvailable = removing && available !== null && quantityNumber > available;

  const canSubmit =
    !!product &&
    !!warehouseId &&
    quantityNumber > 0 &&
    reason.trim().length >= 3 &&
    !overAvailable &&
    !submitting;

  const resultingBalance =
    available === null || !quantityNumber
      ? null
      : available + (removing ? -quantityNumber : quantityNumber);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !product) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const common = {
        productId: product._id,
        warehouseId,
        reason: reason.trim(),
        batchNumber: batchNumber.trim() || undefined,
      };

      const entry =
        mode === 'damage'
          ? // A positive magnitude — the API negates it.
            await inventoryService.recordDamage({ ...common, quantity: quantityNumber })
          : // Signed — the sign IS the direction.
            await inventoryService.adjustStock({
              ...common,
              quantity: removing ? -quantityNumber : quantityNumber,
            });

      setSuccess(
        `Recorded. ${product.name} now stands at ${formatQty(entry.runningBalance)} in this warehouse.`
      );
      setQuantity('');
      setBatchNumber('');
      setReason('');
      const stock = await inventoryService.getCurrentStock({
        productId: product._id,
        includeZero: true,
      });
      setStockRow(stock.items[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the movement');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Stock adjustment</h1>
        <p className="text-sm text-muted-foreground">
          Correct a count or write off damaged stock. Every entry is appended to
          the ledger with its reason and cannot be edited afterwards.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <div className="inline-flex rounded-md border p-0.5">
              {(['adjustment', 'damage'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setMode(option);
                    setReason('');
                  }}
                  className={cn(
                    'rounded px-3 py-1.5 text-sm capitalize transition-colors',
                    mode === option
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {option === 'adjustment' ? 'Adjustment' : 'Damage / loss'}
                </button>
              ))}
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent>
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-2">
              <Label>Product</Label>
              <ProductPicker value={product} onSelect={setProduct} disabled={submitting} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="warehouse">Warehouse</Label>
                <WarehouseSelect
                  id="warehouse"
                  required
                  warehouses={warehouses}
                  value={warehouseId}
                  onChange={setWarehouseId}
                  placeholder="Select warehouse"
                />
                {available !== null && (
                  <p className="text-xs text-muted-foreground">
                    {formatQty(available)} on hand
                  </p>
                )}
              </div>

              {mode === 'adjustment' && (
                <div className="space-y-2">
                  <Label htmlFor="direction">Direction</Label>
                  <select
                    id="direction"
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as 'increase' | 'decrease')}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="increase">Increase (found more)</option>
                    <option value="decrease">Decrease (found fewer)</option>
                  </select>
                </div>
              )}
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
                {overAvailable ? (
                  <p className="text-xs text-destructive">
                    Only {formatQty(available!)} on hand — stock cannot go negative.
                  </p>
                ) : (
                  resultingBalance !== null && (
                    <p className="text-xs text-muted-foreground">
                      New balance will be {formatQty(resultingBalance)}
                    </p>
                  )
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
              <Label htmlFor="reason">Reason (required)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
                required
                minLength={3}
                placeholder="Why is this being recorded?"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {REASONS[mode].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setReason(suggestion)}
                    className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
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
              <Button
                type="submit"
                variant={mode === 'damage' ? 'destructive' : 'default'}
                disabled={!canSubmit}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {mode === 'damage' ? 'Write off stock' : 'Record adjustment'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
