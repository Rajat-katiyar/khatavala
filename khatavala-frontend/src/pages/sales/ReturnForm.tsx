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
import * as salesService from '@/services/sales.service';
import type { PaymentMode, ReturnableInvoice, ReturnReason, SalesDocument } from '@/types';
import { moneyCell } from './SalesParts';

/**
 * Record a sales return: pick the invoice → pick the lines → say why.
 *
 * The refund figure is CALCULATED, never typed. It is each line's share of what
 * the customer actually paid — their price, their discount, their GST rate on
 * the day — and a free-text refund box would let a busy counter credit the
 * wrong amount with no way to notice. The server recomputes it identically and
 * ignores anything the client sends as a total.
 */

const REASONS: { value: ReturnReason; label: string }[] = [
  { value: 'Damaged', label: 'Damaged' },
  { value: 'Expired', label: 'Expired' },
  { value: 'WrongItem', label: 'Wrong item supplied' },
  { value: 'NotRequired', label: 'No longer required' },
  { value: 'QualityIssue', label: 'Quality issue' },
  { value: 'Other', label: 'Other' },
];

/** Reasons where the goods usually cannot go back on the shelf. */
const UNSALEABLE: ReturnReason[] = ['Damaged', 'Expired', 'QualityIssue'];

const round2 = (value: number) => Math.round(value * 100) / 100;

export function ReturnForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SalesDocument[]>([]);
  const [searching, setSearching] = useState(false);
  const [source, setSource] = useState<ReturnableInvoice | null>(null);

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason>('Damaged');
  const [reasonNotes, setReasonNotes] = useState('');
  const [restock, setRestock] = useState(false);
  const [refundNow, setRefundNow] = useState(false);
  const [refundMode, setRefundMode] = useState<PaymentMode>('Cash');

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInvoice = useCallback(async (invoiceId: string) => {
    setLoading(true);
    setError(null);
    try {
      const fetched = await salesService.getReturnableLines(invoiceId);
      setSource(fetched);
      setQuantities({});
      setResults([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the invoice');
    } finally {
      setLoading(false);
    }
  }, []);

  // Arriving from an invoice's "Return" button skips the search step entirely.
  useEffect(() => {
    const invoiceId = params.get('invoiceId');
    if (invoiceId) void loadInvoice(invoiceId);
  }, [params, loadInvoice]);

  useEffect(() => {
    if (!search.trim() || source) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const page = await salesService.listDocuments('invoices', {
          search,
          limit: 8,
        });
        // Only posted invoices can be returned against — a draft moved no stock
        // and owes no credit.
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

  // Damaged goods default to NOT going back on the shelf; the operator can
  // override. Defaulting the other way quietly puts broken stock back on sale.
  useEffect(() => {
    setRestock(!UNSALEABLE.includes(reason));
  }, [reason]);

  const selected = useMemo(
    () =>
      (source?.lines ?? [])
        .map((line) => ({ line, quantity: quantities[line.lineItemId] ?? 0 }))
        .filter((entry) => entry.quantity > 0),
    [source, quantities]
  );

  /** Mirrors the server's per-line arithmetic. Display only. */
  const refundTotal = useMemo(() => {
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

  const alreadyPaid = source?.invoice.amountPaid ?? 0;
  // Cash can only be handed back if cash was taken — capped at both.
  const maxRefund = Math.min(refundTotal, alreadyPaid);

  const submit = async () => {
    if (!source || selected.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await salesService.createReturn({
        invoiceId: source.invoice._id,
        lines: selected.map(({ line, quantity }) => ({
          lineItemId: line.lineItemId,
          quantity,
        })),
        reason,
        reasonNotes: reasonNotes.trim() || null,
        restock,
        ...(refundNow && maxRefund > 0
          ? { refundAmount: maxRefund, refundMode }
          : {}),
      });
      navigate(`/sales/invoices/${source.invoice._id}`, {
        state: { returned: result.salesReturn.documentNumber },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the return');
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link to="/sales/invoices">
            <ArrowLeft className="mr-2 h-4 w-4" /> Invoices
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">New sales return</h1>
        <p className="text-sm text-muted-foreground">
          Goods come back into stock and the customer is credited — both posted
          together, as one entry.
        </p>
      </div>

      {!source ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Find the original invoice</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Invoice number or customer name"
                className="pl-8"
                autoFocus
              />
              {searching && (
                <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {results.length > 0 && (
              <ul className="divide-y rounded-md border">
                {results.map((invoice) => (
                  <li key={invoice._id}>
                    <button
                      type="button"
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-accent"
                      onClick={() => loadInvoice(invoice._id)}
                    >
                      <span>
                        <span className="font-medium">{invoice.documentNumber}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {invoice.customerName}
                        </span>
                      </span>
                      <span className="text-muted-foreground">
                        {formatDate(invoice.date)} ·{' '}
                        {formatMoney(invoice.grandTotal, currency)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {loading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading invoice…
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
                  {source.invoice.documentNumber}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {source.invoice.customerName} · {formatDate(source.invoice.date)} ·{' '}
                  {formatMoney(source.invoice.grandTotal, currency)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSource(null);
                  setSearch('');
                }}
              >
                Change
              </Button>
            </CardHeader>
            <CardContent>
              {source.previousReturns.length > 0 && (
                <p className="mb-3 text-xs text-muted-foreground">
                  {source.previousReturns.length} previous return
                  {source.previousReturns.length > 1 ? 's' : ''} against this invoice ·{' '}
                  {formatMoney(source.invoice.returnedAmount, currency)} already credited
                </p>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Sold</TableHead>
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
                      <TableRow
                        key={line.lineItemId}
                        className={cn(exhausted && 'opacity-50')}
                      >
                        <TableCell>
                          <div className="font-medium">{line.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {formatMoney(line.unitPrice, currency)}
                            {line.discountPercent > 0 && ` · ${line.discountPercent}% off`}
                            {line.gstPercent > 0 && ` · ${line.gstPercent}% GST`}
                          </div>
                        </TableCell>
                        <TableCell className={moneyCell()}>{line.quantity}</TableCell>
                        <TableCell className={moneyCell('text-muted-foreground')}>
                          {line.alreadyReturned || '—'}
                        </TableCell>
                        <TableCell className={moneyCell()}>
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
                            onChange={(e) => {
                              const next = Number(e.target.value);
                              setQuantities((current) => ({
                                ...current,
                                // Clamped here as well as on the server: the
                                // operator should not be able to type a number
                                // that will only fail on submit.
                                [line.lineItemId]: Math.max(
                                  0,
                                  Math.min(next, line.returnable)
                                ),
                              }));
                            }}
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
                    onChange={(e) => setReason(e.target.value as ReturnReason)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {REASONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
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

              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={restock}
                  onChange={(e) => setRestock(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  Put the goods back into sellable stock
                  <span className="block text-xs text-muted-foreground">
                    Leave off for damaged or expired items — the customer is still
                    credited in full, the stock just does not come back.
                  </span>
                </span>
              </label>

              {alreadyPaid > 0 && (
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={refundNow}
                    onChange={(e) => setRefundNow(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    Refund {formatMoney(maxRefund, currency)} now
                    <span className="block text-xs text-muted-foreground">
                      Otherwise the credit stays on the customer&apos;s account
                      against future purchases.
                    </span>
                  </span>
                </label>
              )}

              {refundNow && (
                <div className="w-48 space-y-1.5">
                  <Label htmlFor="refund-mode">Refund by</Label>
                  <select
                    id="refund-mode"
                    value={refundMode}
                    onChange={(e) => setRefundMode(e.target.value as PaymentMode)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {(['Cash', 'UPI', 'Card', 'Bank'] as PaymentMode[]).map((option) => (
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
                <p className="text-sm text-muted-foreground">Credit note value</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {formatMoney(refundTotal, currency)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {selected.length} line{selected.length === 1 ? '' : 's'} selected
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => navigate('/sales/invoices')}>
                  Cancel
                </Button>
                <Button
                  disabled={selected.length === 0 || submitting}
                  onClick={submit}
                >
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
