import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import * as productService from '@/services/product.service';
import type { MovementType, Product, Warehouse } from '@/types';

/**
 * Quantities are NOT money: `formatMoney` would print "₹8.00" for eight boxes.
 * Stock is also frequently fractional (1.5 kg) but usually whole, so trailing
 * zeros are dropped rather than padded — a column of "12" reads better than
 * "12.000" when nothing in it is fractional.
 */
export function formatQty(quantity: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(quantity);
}

/** The sign convention from the server, rendered. Positive in, negative out. */
export function MovementBadge({ type }: { type: MovementType }) {
  const variant =
    type === 'Damage' ? 'destructive' : type === 'In' ? 'secondary' : 'outline';
  return (
    <Badge variant={variant} className="text-[10px]">
      {type}
    </Badge>
  );
}

/** Shared warning styling, so "low stock" looks the same on every screen. */
export const LOW_STOCK_ROW =
  'bg-amber-50 hover:bg-amber-100/80 dark:bg-amber-950/30 dark:hover:bg-amber-950/50';
export const LOW_STOCK_TEXT = 'text-amber-700 dark:text-amber-400';

export function WarehouseSelect({
  warehouses,
  value,
  onChange,
  placeholder = 'All warehouses',
  required,
  id,
}: {
  warehouses: Pick<Warehouse, '_id' | 'name'>[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  id?: string;
}) {
  return (
    <select
      id={id}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option value="">{placeholder}</option>
      {warehouses.map((warehouse) => (
        <option key={warehouse._id} value={warehouse._id}>
          {warehouse.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Typeahead product picker.
 *
 * A plain <select> is wrong here: a catalog runs to thousands of SKUs and the
 * user knows the name or the barcode, not the position in a list. Search is
 * debounced so typing "parle" is one request rather than five.
 */
export function ProductPicker({
  value,
  onSelect,
  disabled,
}: {
  value: Product | null;
  onSelect: (product: Product | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim() || value) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const found = await productService.searchProducts(query, 8);
        if (!cancelled) {
          setResults(found);
          setOpen(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, value]);

  // Close on outside click, so the list does not hang over the rest of the form.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input px-3 py-2 text-sm">
        <span>
          {value.name} <span className="text-muted-foreground">({value.sku})</span>
        </span>
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => {
            onSelect(null);
            setQuery('');
          }}
          disabled={disabled}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <Input
        value={query}
        disabled={disabled}
        placeholder="Search by name, SKU or barcode…"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        autoComplete="off"
      />
      {loading && (
        <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
      )}
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-background shadow-md">
          {results.map((product) => (
            <li key={product._id}>
              <button
                type="button"
                className={cn(
                  'flex w-full items-center justify-between px-3 py-2 text-left text-sm',
                  'hover:bg-accent hover:text-accent-foreground'
                )}
                onClick={() => {
                  onSelect(product);
                  setOpen(false);
                }}
              >
                <span>{product.name}</span>
                <span className="text-xs text-muted-foreground">{product.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && query.trim() && results.length === 0 && (
        <p className="absolute z-20 mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground shadow-md">
          No products match “{query}”.
        </p>
      )}
    </div>
  );
}
