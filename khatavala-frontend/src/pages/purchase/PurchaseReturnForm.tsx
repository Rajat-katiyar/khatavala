import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { cn, formatDate, formatMoney } from '@/lib/utils';
import * as purchaseService from '@/services/purchase.service';
import type {
  PaymentMode,
  PurchaseDocument,
  PurchaseReturnable,
  PurchaseReturnReason,
} from '@/types';

/**
 * Record a purchase return — goods going back to a supplier.
 *
 * The mirror of the sales ReturnForm, and it makes the same call about the
 * money: the debit-note value is CALCULATED from the bill's own rates, never
 * typed. We debit the supplier what they charged us, not what the item is worth
 * today.
 */

const REASONS: { value: PurchaseReturnReason; label: string }[] = [
  { value: 'Damaged', label: 'Damaged on arrival' },
  { value: 'Expired', label: 'Expired / near expiry' },
  { value: 'WrongItem', label: 'Wrong item supplied' },
  { value: 'ShortSupply', label: 'Short supply' },
  { value: 'QualityIssue', label: 'Quality issue' },
  { value: 'RateDifference', label: 'Rate difference (no goods)' },
  { value: 'Other', label: 'Other' },
];

const round2 = (value: number) => Math.round(value * 100) / 100;

export function PurchaseReturnForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<PurchaseDocument[]>([]);
  const [searching, setSearching] = useState(false);
  const [source, setSource] = useState<PurchaseReturnable | null>(null);

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<PurchaseReturnReason>('Damaged');
  const [reasonNotes, setReasonNotes] = useState('');
  const [refundNow, setRefundNow] = useState(false);
  const [refundMode, setRefundMode] = useState<PaymentMode>('Bank');

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBill = useCallback(async (invoiceId: string) => {
    setLoading(true);
    setError(null);
    try {
      setSource(await purchaseService.getReturnableLines(invoiceId));
      setQuantities({});
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the bill');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const invoiceId = params.get('invoiceId');
    if (invoiceId) void loadBill(invoiceId);
  }, [params, loadBill]);

  useEffect(() => {
    if (!search.trim() || source) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const page = await purchaseService.listDocuments('invoices', {
          search,
          limit: 8,
        });
        // Only posted bills can be returned against — a draft posted no payable.
        if (!cancelled) {
          setResults(
            page.documents.filter((d) =>
              ['Unpaid', 'PartiallyPaid', 'Paid'].includes(d.status)
            )
          );
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, source]);

  // A rate difference moves no goods — the supplier is debited without stock
  // leaving. Everything else does return stock.
  const returnsStock = reason !== 'RateDifference';

  const selected = useMemo(
    () =>
      (source?.lines ?? [])
        .map((line) => ({ line, quantity: quantities[line.lineItemId] ?? 0 }))
        .filter((entry) => entry.quantity > 0),
    [source, quantities]
  );

  /** Mirrors the server's per-line arithmetic. Display only. */
  const debitTotal = useMemo(() => {
    let beforeRounding = 0;
    for (const { line, quantity } of selected) {
      const gross = round2(quantity * line.unitPrice);
      const discount = round2((gross * line.discountPercent) / 100);
      const taxable = round2(gross - discount);
      const tax = round2((taxable * line.gstPercent) / 100);
      beforeRounding = round2(beforeRounding + taxable + tax);
    }
    return Math.round(beforeRounding);
  }, [selected]);

  const alreadyPaid = source?.purchaseInvoice.amountPaid ?? 0;
  // The supplier can only refund what we actually paid them.
  const maxRefund = Math.min(debitTotal, alreadyPaid);

  const submit = async () => {
    if (!source || selected.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await purchaseService.createPurchaseReturn({
        purchaseInvoiceId: source.purchaseInvoice._id,
        lines: selected.map(({ line, quantity }) => ({
          lineItemId: line.lineItemId,
          quantity,
        })),
        reason,
        reasonNotes: reasonNotes.trim() || null,
        returnsStock,
        ...(refundNow && maxRefund > 0 ? { refundAmount: maxRefund, refundMode } : {}),
      });
      navigate(`/purchase/invoices/${source.purchaseInvoice._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the return');
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link to="/purchase/invoices">
            <ArrowLeft className="mr-2 h-4 w-4" /> Purchase bills
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">New purchase return</h1>
        <p className="text-sm text-muted-foreground">
          Goods go back to the supplier and a debit note reduces what we owe —
          both posted together, as one entry.
        </p>
      </div>

      {!source ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Find the supplier&apos;s bill</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Bill number or supplier name"
                className="pl-8"
                autoFocus
              />
              {searching && (
                <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {results.length > 0 && (
              <ul className="divide-y rounded-md border">
                {results.map((bill) => (
                  <li key={bill._id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-accent"
                      onClick={() => loadBill(bill._id)}
                    >
                      <span>
                        <span className="font-medium">{bill.documentNumber}</span>
                        <span className="text-muted-foreground"> · {bill.supplierName}</span>
                      </span>
                      <span className="text-muted-foreground">
                        {formatDate(bill.date)} · {formatMoney(bill.grandTotal, currency)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading bill…
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">
                  {source.purchaseInvoice.documentNumber}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {source.purchaseInvoice.supplierName} ·{' '}
                  {formatDate(source.purchaseInvoice.date)} ·{' '}
                  {formatMoney(source.purchaseInvoice.grandTotal, currency)}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSource(null)}>
                Change
              </Button>
            </CardHeader>
            <CardContent>
              {source.previousReturns.length > 0 && (
                <p className="mb-3 text-xs text-muted-foreground">
                  {source.previousReturns.length} previous return
                  {source.previousReturns.length > 1 ? 's' : ''} ·{' '}
                  {formatMoney(source.purchaseInvoice.returnedAmount, currency)} already debited
                </p>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Billed</TableHead>
                    <TableHead className="text-right">Returned</TableHead>
                    <TableHead className="text-right">Returnable</TableHead>
                    <TableHead className="w-32 text-right">Return qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {source.lines.map((line) => {
                    const value = quantities[line.lineItemId] ?? 0;
                    const exhausted = line.returnable <= 0;
                    return (
                      <TableRow key={line.lineItemId} className={cn(exhausted && 'opacity-50')}>
                        <TableCell>
                          <div className="font-medium">{line.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatMoney(line.unitPrice, currency)}
                            {line.gstPercent > 0 && ` · ${line.gstPercent}% GST`}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.quantity}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {line.alreadyReturned || '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {exhausted ? (
                            <Badge variant="muted" className="text-[10px]">
                              None left
                            </Badge>
                          ) : (
                            line.returnable
                          )}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            max={line.returnable}
                            step="any"
                            disabled={exhausted}
                            value={value || ''}
                            onChange={(e) =>
                              setQuantities((current) => ({
                                ...current,
                                // Clamped here as well as on the server, so the
                                // user cannot type a number that only fails on
                                // submit.
                                [line.lineItemId]: Math.max(
                                  0,
                                  Math.min(Number(e.target.value), line.returnable)
                                ),
                              }))
                            }
                            className="h-9 text-right"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Reason and refund</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="reason">Reason</Label>
                  <select
                    id="reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value as PurchaseReturnReason)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {REASONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {!returnsStock && (
                    <p className="text-xs text-muted-foreground">
                      No goods move — the supplier is debited for the difference only.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="notes">Notes</Label>
                  <Input
                    id="notes"
                    value={reasonNotes}
                    onChange={(e) => setReasonNotes(e.target.value)}
                    placeholder="Optional detail"
                  />
                </div>
              </div>

              {alreadyPaid > 0 && (
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={refundNow}
                    onChange={(e) => setRefundNow(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    The supplier refunded {formatMoney(maxRefund, currency)}
                    <span className="block text-xs text-muted-foreground">
                      Otherwise the debit sits against their account and reduces
                      the next bill.
                    </span>
                  </span>
                </label>
              )}

              {refundNow && (
                <div className="w-48 space-y-1.5">
                  <Label htmlFor="refund-mode">Received by</Label>
                  <select
                    id="refund-mode"
                    value={refundMode}
                    onChange={(e) => setRefundMode(e.target.value as PaymentMode)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {(['Bank', 'Cash', 'UPI', 'Cheque'] as PaymentMode[]).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
              <div>
                <p className="text-sm text-muted-foreground">Debit note value</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatMoney(debitTotal, currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selected.length} line{selected.length === 1 ? '' : 's'} selected
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigate('/purchase/invoices')}>
                  Cancel
                </Button>
                <Button disabled={selected.length === 0 || submitting} onClick={submit}>
                  {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Record return
                </Button>
              </div>
            </CardContent>
          </Card>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}
