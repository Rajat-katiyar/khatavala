import { Badge } from '@/components/ui/badge';
import type { Product, Ref, Unit } from '@/types';

/**
 * A master reference arrives as a bare id when unpopulated and as an object
 * when the API populated it. These readers cope with both so a caller never
 * has to guess which shape it got.
 */
export function refName(ref: Ref<{ _id: string; name: string }>): string | null {
  if (!ref || typeof ref === 'string') return null;
  return ref.name;
}

export function unitSymbol(ref: Ref<Unit>): string | null {
  if (!ref || typeof ref === 'string') return null;
  return ref.symbol;
}

export function refId(ref: Ref<{ _id: string }>): string {
  if (!ref) return '';
  return typeof ref === 'string' ? ref : ref._id;
}

/**
 * Stock with its meaning, not just a number.
 *
 * "Low" is at-or-below the reorder level but still sellable; "out" is a
 * different problem and gets a different colour. A single grey number would
 * hide both.
 */
export function StockBadge({ product }: { product: Product }) {
  const stock = product.currentStock ?? 0;
  const unit = unitSymbol(product.primaryUnitId);
  const suffix = unit ? ` ${unit}` : '';

  if (stock <= 0) {
    return (
      <Badge variant="destructive" className="text-[10px]">
        Out of stock
      </Badge>
    );
  }

  const low = product.minStockLevel > 0 && stock <= product.minStockLevel;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={low ? 'font-medium text-amber-600 dark:text-amber-400' : 'font-medium'}>
        {stock}
        {suffix}
      </span>
      {low && (
        <Badge variant="outline" className="border-amber-500 text-[10px] text-amber-600 dark:text-amber-400">
          Low
        </Badge>
      )}
    </span>
  );
}
