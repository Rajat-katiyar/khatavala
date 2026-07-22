import { formatMoney } from '@/lib/utils';

export type CustomerSortField =
  | 'name'
  | 'phone'
  | 'currentBalance'
  | 'creditLimit'
  | 'createdAt';

// The header itself is generic and shared with suppliers; re-exported here so
// the list page keeps importing its table pieces from one place.
export { SortableHead } from '@/components/SortableHead';

/**
 * Renders a balance with its meaning, not just its sign — a bare "-750" reads
 * as a mistake, where "750 advance" reads as money we are holding.
 */
export function BalanceCell({ amount, currency }: { amount: number; currency: string }) {
  if (amount === 0) return <span className="text-muted-foreground">—</span>;
  const owed = amount > 0;
  return (
    <span className={owed ? 'font-medium text-destructive' : 'font-medium text-emerald-600 dark:text-emerald-400'}>
      {formatMoney(Math.abs(amount), currency)}
      <span className="ml-1 text-xs font-normal text-muted-foreground">
        {owed ? 'due' : 'advance'}
      </span>
    </span>
  );
}
