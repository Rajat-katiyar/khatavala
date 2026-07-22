import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatMoney } from '@/lib/utils';

/**
 * The statement-of-account table, shared by the customer and supplier profiles.
 *
 * Both sides render the same six columns from the same entry shape, so this is
 * one component rather than two that drift apart. What it does NOT do is
 * interpret the balance: a positive figure means "owes us" on a customer and
 * "we owe them" on a supplier, so the caller passes `balanceLabel` and the
 * table stays agnostic. Baking in "due" would silently mislabel every payable.
 */

export interface LedgerEntryRow {
  _id: string;
  date: string;
  type: string;
  debit: number;
  credit: number;
  runningBalance: number;
  narration?: string;
}

/** Entry types that reduce the balance, shown in the softer badge. */
const SETTLING_TYPES = new Set(['Payment', 'CreditNote', 'DebitNote']);

export function LedgerTable({
  entries,
  totals,
  closingBalance,
  currency,
  debitLabel = 'Debit',
  creditLabel = 'Credit',
  emptyMessage,
}: {
  entries: LedgerEntryRow[];
  totals: { debit: number; credit: number };
  closingBalance: number;
  currency: string;
  /** Column headings, so each side can name its columns in its own terms. */
  debitLabel?: string;
  creditLabel?: string;
  emptyMessage: string;
}) {
  if (entries.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-28">Date</TableHead>
          <TableHead className="w-32">Type</TableHead>
          <TableHead>Particulars</TableHead>
          <TableHead className="text-right">{debitLabel}</TableHead>
          <TableHead className="text-right">{creditLabel}</TableHead>
          <TableHead className="text-right">Balance</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry._id}>
            <TableCell className="whitespace-nowrap text-muted-foreground">
              {formatDate(entry.date)}
            </TableCell>
            <TableCell>
              <Badge
                variant={SETTLING_TYPES.has(entry.type) ? 'secondary' : 'outline'}
                className="text-[10px]"
              >
                {entry.type}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{entry.narration || '—'}</TableCell>
            <TableCell className="text-right">
              {entry.debit ? formatMoney(entry.debit, currency) : '—'}
            </TableCell>
            <TableCell className="text-right">
              {entry.credit ? formatMoney(entry.credit, currency) : '—'}
            </TableCell>
            <TableCell className="text-right font-medium">
              {formatMoney(entry.runningBalance, currency)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={3}>Totals</TableCell>
          <TableCell className="text-right">{formatMoney(totals.debit, currency)}</TableCell>
          <TableCell className="text-right">{formatMoney(totals.credit, currency)}</TableCell>
          <TableCell className="text-right">{formatMoney(closingBalance, currency)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
