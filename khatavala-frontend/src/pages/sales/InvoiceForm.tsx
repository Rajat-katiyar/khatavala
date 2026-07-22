import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Barcode, Loader2, Trash2 } from 'lucide-react';
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
import { formatMoney } from '@/lib/utils';
import * as productService from '@/services/product.service';
import * as salesService from '@/services/sales.service';
import type { Customer, Product } from '@/types';
import { CustomerPicker, moneyCell } from './SalesParts';

/**
 * FAST INVOICE ENTRY
 * ==================
 * Optimised for a counter, where the operator is scanning items and looking at
 * the customer rather than at the screen:
 *
 *  - The scan box holds focus and returns to itself after every add, so a
 *    barcode gun (which types the code and presses Enter) can add item after
 *    item with no clicks at all.
 *  - An exact barcode or SKU match is added IMMEDIATELY on Enter rather than
 *    showing a list to choose from — a scan is unambiguous, and making the
 *    operator confirm it would waste the whole point of scanning.
 *  - Scanning something already on the invoice bumps its quantity instead of
 *    adding a duplicate line.
 *  - Totals recompute locally on every keystroke, so the operator can read the
 *    figure out loud before the server has been touched.
 *
 * THE LOCAL TOTALS ARE A PREVIEW, NOT THE INVOICE. The server recomputes every
 * figure from the line inputs and its own product master (see
 * salesDocument.factory.ts) and ignores anything a client sends as a total. The
 * arithmetic here is duplicated deliberately for responsiveness; if the two ever
 * disagree, the server is right.
 */

interface DraftLine {
  key: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  gstPercent: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Mirrors computeTotals on the server; see the note above. */
function lineAmounts(line: DraftLine) {
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

export function InvoiceForm() {
  const navigate = useNavigate();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [scan, setScan] = useState('');
  const [matches, setMatches] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [nextNumber, setNextNumber] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    salesService.getNextInvoiceNumber().then(setNextNumber).catch(() => setNextNumber(null));
    scanRef.current?.focus();
  }, []);

  const addProduct = useCallback((product: Product) => {
    setLines((current) => {
      const existing = current.find((line) => line.product._id === product._id);
      if (existing) {
        return current.map((line) =>
          line.key === existing.key ? { ...line, quantity: line.quantity + 1 } : line
        );
      }
      return [
        ...current,
        {
          key: `${product._id}-${current.length}`,
          product,
          quantity: 1,
          unitPrice: product.sellingPrice ?? 0,
          discountPercent: 0,
          gstPercent: product.gstPercentage ?? 0,
        },
      ];
    });
    setScan('');
    setMatches([]);
    scanRef.current?.focus();
  }, []);

  // Debounced lookahead for typed (rather than scanned) input.
  useEffect(() => {
    if (!scan.trim()) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await productService.searchProducts(scan, 8);
        if (!cancelled) setMatches(found);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scan]);

  /**
   * Enter is the scanner's terminator. An exact barcode or SKU hit is added
   * straight away; otherwise the single best match is taken, which makes typing
   * a partial name and hitting Enter work as well as scanning does.
   */
  const onScanKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    const term = scan.trim();
    if (!term) return;

    const exact =
      matches.find((product) => product.barcode?.toLowerCase() === term.toLowerCase()) ??
      matches.find((product) => product.sku?.toLowerCase() === term.toLowerCase());

    if (exact) {
      addProduct(exact);
      return;
    }

    // The debounce may not have fired yet if the gun typed fast — look up
    // synchronously rather than silently doing nothing on Enter.
    const found = matches.length > 0 ? matches : await productService.searchProducts(term, 1);
    if (found.length > 0) addProduct(found[0]);
    else setError(`Nothing matches “${term}”`);
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );

  const removeLine = (key: string) =>
    setLines((current) => current.filter((line) => line.key !== key));

  const totals = useMemo(() => {
    const computed = lines.map(lineAmounts);
    const subTotal = round2(computed.reduce((sum, line) => sum + line.gross, 0));
    const totalDiscount = round2(computed.reduce((sum, line) => sum + line.discountAmount, 0));
    const totalTax = round2(computed.reduce((sum, line) => sum + line.taxAmount, 0));
    const beforeRounding = round2(computed.reduce((sum, line) => sum + line.lineTotal, 0));
    const grandTotal = Math.round(beforeRounding);
    return {
      subTotal,
      totalDiscount,
      totalTax,
      roundOff: round2(grandTotal - beforeRounding),
      grandTotal,
    };
  }, [lines]);

  const canSubmit = !!customer && lines.length > 0 && !submitting;

  const submit = async (confirm: boolean) => {
    if (!customer || lines.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const invoice = await salesService.createDocument('invoices', {
        customerId: customer._id,
        confirm,
        dueDate: dueDate || undefined,
        notes: notes.trim() || undefined,
        lineItems: lines.map((line) => ({
          productId: line.product._id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          gstPercent: line.gstPercent,
        })),
      });
      navigate(`/sales/invoices/${invoice._id}`);
    } catch (err) {
      // The most likely failure is insufficient stock, which the server rejects
      // atomically — nothing was written, so the operator can fix the line and
      // resubmit without worrying about a half-posted invoice.
      setError(err instanceof Error ? err.message : 'Could not create the invoice');
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">New invoice</h1>
          <p className="text-sm text-muted-foreground">
            {nextNumber ? (
              <>
                Will be numbered <span className="font-medium">{nextNumber}</span> · scan or
                type to add items
              </>
            ) : (
              'Scan or type to add items'
            )}
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate('/sales/invoices')}>
          Cancel
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="relative">
                <Barcode className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={scanRef}
                  value={scan}
                  onChange={(e) => {
                    setScan(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={onScanKeyDown}
                  placeholder="Scan a barcode, or type a name / SKU and press Enter"
                  className="pl-8"
                  autoComplete="off"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
                )}

                {matches.length > 0 && scan.trim() && (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-background shadow-md">
                    {matches.map((product) => (
                      <li key={product._id}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                          onClick={() => addProduct(product)}
                        >
                          <span>{product.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {product.sku} · {formatMoney(product.sellingPrice ?? 0, currency)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {lines.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No items yet. Scan a barcode to begin.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-20 text-right">Qty</TableHead>
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
                      return (
                        <TableRow key={line.key}>
                          <TableCell>
                            <div className="font-medium">{line.product.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {line.product.sku}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={line.quantity}
                              onChange={(e) =>
                                updateLine(line.key, { quantity: Number(e.target.value) })
                              }
                              className="h-8 text-right"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              value={line.unitPrice}
                              onChange={(e) =>
                                updateLine(line.key, { unitPrice: Number(e.target.value) })
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
                              value={line.discountPercent}
                              onChange={(e) =>
                                updateLine(line.key, {
                                  discountPercent: Number(e.target.value),
                                })
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
                              onChange={(e) =>
                                updateLine(line.key, { gstPercent: Number(e.target.value) })
                              }
                              className="h-8 text-right"
                            />
                          </TableCell>
                          <TableCell className={moneyCell('font-medium')}>
                            {formatMoney(amounts.lineTotal, currency)}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => removeLine(line.key)}
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
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Customer</CardTitle>
            </CardHeader>
            <CardContent>
              <CustomerPicker value={customer} onSelect={setCustomer} disabled={submitting} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Subtotal" value={formatMoney(totals.subTotal, currency)} />
              {totals.totalDiscount > 0 && (
                <Row
                  label="Discount"
                  value={`- ${formatMoney(totals.totalDiscount, currency)}`}
                />
              )}
              <Row label="GST" value={formatMoney(totals.totalTax, currency)} />
              {totals.roundOff !== 0 && (
                <Row label="Round off" value={formatMoney(totals.roundOff, currency)} />
              )}
              <div className="border-t pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Total</span>
                  <span className="text-xl font-semibold tabular-nums">
                    {formatMoney(totals.grandTotal, currency)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="dueDate">Payment due</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Printed on the invoice"
                />
              </div>
            </CardContent>
          </Card>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="space-y-2">
            <Button className="w-full" disabled={!canSubmit} onClick={() => submit(true)}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save &amp; confirm
            </Button>
            {/* Confirming posts stock and the ledger; a draft does neither, so
                the two are separate buttons rather than a checkbox someone
                could leave in the wrong state. */}
            <Button
              variant="outline"
              className="w-full"
              disabled={!canSubmit}
              onClick={() => submit(false)}
            >
              Save as draft
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Confirming deducts stock and posts to the customer&apos;s ledger.
            </p>
          </div>
        </div>
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
