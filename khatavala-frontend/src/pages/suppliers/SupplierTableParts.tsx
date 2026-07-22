import { Star } from 'lucide-react';
import { formatMoney } from '@/lib/utils';

export type SupplierSortField =
  | 'name'
  | 'phone'
  | 'currentBalance'
  | 'vendorRating'
  | 'createdAt';

/**
 * Renders a payable with its meaning, not just its sign.
 *
 * The customer equivalent labels a positive balance "due"; here it is "payable"
 * because the money moves the other way. Same component shape, different words
 * on purpose — a shared "due/advance" label would misdescribe one side.
 */
export function PayableCell({ amount, currency }: { amount: number; currency: string }) {
  if (amount === 0) return <span className="text-muted-foreground">—</span>;
  const weOwe = amount > 0;
  return (
    <span className={weOwe ? 'font-medium text-destructive' : 'font-medium text-emerald-600 dark:text-emerald-400'}>
      {formatMoney(Math.abs(amount), currency)}
      <span className="ml-1 text-xs font-normal text-muted-foreground">
        {weOwe ? 'payable' : 'prepaid'}
      </span>
    </span>
  );
}

export function RatingStars({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={`h-3.5 w-3.5 ${
            star <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'
          }`}
        />
      ))}
    </span>
  );
}
