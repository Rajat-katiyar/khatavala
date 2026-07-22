import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn, formatMoney } from '@/lib/utils';
import type { Product } from '@/types';

/**
 * The line-item grid, shared by every document that has lines — sales invoices
 * and the whole purchase side.
 *
 * The arithmetic here is a PREVIEW. The server recomputes every figure from the
 * line inputs and its own product master, and ignores anything a client sends
 * as a total (see tradeDocument.factory.ts). It is duplicated in the browser so
 * the total moves as the user types rather than a round trip later; if the two
 * ever disagree, the server is right.
 *
 * `showOrdered` turns on the goods-receipt columns: what the purchase order
 * asked for, beside what actually arrived. Off everywhere else.
 */

export interface EditorLine {
  key: string;
  product: Pick<Product, '_id' | 'name' | 'sku'>;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  gstPercent: number;
  /** GRN only — read-only context from the purchase order. */
  orderedQuantity?: number | null;
  sourceLineItemId?: string | null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Mirrors the server's per-line arithmetic exactly. */
export function lineAmounts(line: EditorLine) {
  const gross = round2(line.quantity * line.unitPrice);
  const discountAmount = round2((gross * line.discountPercent) / 100);
  const taxableAmount = round2(gross - discountAmount);
  const taxAmount = round2((taxableAmount * line.gstPercent) / 100);
  return {
    gross,
    discountAmount,
    taxableAmount,
    taxAmount,
    lineTotal: round2(taxableAmount + taxAmount),
  };
}

export function documentTotals(lines: EditorLine[]) {
  const computed = lines.map(lineAmounts);
  const subTotal = round2(computed.reduce((sum, l) => sum + l.gross, 0));
  const totalDiscount = round2(computed.reduce((sum, l) => sum + l.discountAmount, 0));
  const totalTax = round2(computed.reduce((sum, l) => sum + l.taxAmount, 0));
  const beforeRounding = round2(computed.reduce((sum, l) => sum + l.lineTotal, 0));
  const grandTotal = Math.round(beforeRounding);
  return {
    subTotal,
    totalDiscount,
    totalTax,
    roundOff: round2(grandTotal - beforeRounding),
    grandTotal,
  };
}

export function LineItemEditor({
  lines,
  currency,
  onChange,
  onRemove,
  showOrdered = false,
  emptyMessage = 'No items yet.',
}: {
  lines: EditorLine[];
  currency: string;
  onChange: (key: string, patch: Partial<EditorLine>) => void;
  onRemove: (key: string) => void;
  showOrdered?: boolean;
  emptyMessage?: string;
}) {
  if (lines.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          {showOrdered && <TableHead className="w-20 text-right">Ordered</TableHead>}
          <TableHead className="w-24 text-right">
            {showOrdered ? 'Received' : 'Qty'}
          </TableHead>
          <TableHead className="w-28 text-right">Rate</TableHead>
          <TableHead className="w-20 text-right">Disc %</TableHead>
          <TableHead className="w-20 text-right">GST %</TableHead>
          <TableHead className="w-28 text-right">Amount</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => {
          const amounts = lineAmounts(line);
          // A short delivery is worth flagging as the clerk types, not after.
          const short =
            showOrdered &&
            typeof line.orderedQuantity === 'number' &&
            line.quantity < line.orderedQuantity;

          return (
            <TableRow key={line.key}>
              <TableCell>
                <div className="font-medium">{line.product.name}</div>
                <div className="text-xs text-muted-foreground">{line.product.sku}</div>
              </TableCell>

              {showOrdered && (
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {line.orderedQuantity ?? '—'}
                </TableCell>
              )}

              <TableCell>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={line.quantity}
                  onChange={(e) => onChange(line.key, { quantity: Number(e.target.value) })}
                  className={cn(
                    'h-8 text-right',
                    short && 'border-amber-500 focus-visible:ring-amber-500'
                  )}
                />
                {short && (
                  <p className="mt-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                    {round2(line.orderedQuantity! - line.quantity)} short
                  </p>
                )}
              </TableCell>

              <TableCell>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={line.unitPrice}
                  onChange={(e) => onChange(line.key, { unitPrice: Number(e.target.value) })}
                  className="h-8 text-right"
                />
              </TableCell>

              <TableCell>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={line.discountPercent}
                  onChange={(e) =>
                    onChange(line.key, { discountPercent: Number(e.target.value) })
                  }
                  className="h-8 text-right"
                />
              </TableCell>

              <TableCell>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  value={line.gstPercent}
                  onChange={(e) => onChange(line.key, { gstPercent: Number(e.target.value) })}
                  className="h-8 text-right"
                />
              </TableCell>

              <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                {formatMoney(amounts.lineTotal, currency)}
              </TableCell>

              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onRemove(line.key)}
                  title="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

/** The totals block, so both sides print the figures in the same order. */
export function TotalsPanel({
  totals,
  currency,
}: {
  totals: ReturnType<typeof documentTotals>;
  currency: string;
}) {
  return (
    <div className="space-y-2 text-sm">
      <Row label="Subtotal" value={formatMoney(totals.subTotal, currency)} />
      {totals.totalDiscount > 0 && (
        <Row label="Discount" value={`- ${formatMoney(totals.totalDiscount, currency)}`} />
      )}
      <Row label="GST" value={formatMoney(totals.totalTax, currency)} />
      {totals.roundOff !== 0 && (
        <Row label="Round off" value={formatMoney(totals.roundOff, currency)} />
      )}
      <div className="flex items-center justify-between border-t pt-2">
        <span className="font-medium">Total</span>
        <span className="text-xl font-semibold tabular-nums">
          {formatMoney(totals.grandTotal, currency)}
        </span>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
