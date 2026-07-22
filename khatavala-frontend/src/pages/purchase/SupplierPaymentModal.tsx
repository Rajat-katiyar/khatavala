import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import * as purchaseService from '@/services/purchase.service';
import type { PaymentMode, SupplierPaymentHistory } from '@/types';

/**
 * Record a payment TO a supplier, with the bill's payment history above it.
 *
 * Deliberately the same shape as the sales-side PaymentModal — an operator who
 * has learnt one should not have to learn the other. The wording is the only
 * real difference: money going out rather than coming in.
 */

const MODES: PaymentMode[] = ['Cash', 'UPI', 'Card', 'Bank', 'Cheque'];

/** Modes worth capturing a reference for, to reconcile against the bank. */
const NEEDS_REFERENCE: PaymentMode[] = ['UPI', 'Card', 'Bank', 'Cheque'];

export function SupplierPaymentModal({
  open,
  onClose,
  purchaseInvoiceId,
  currency,
  onRecorded,
}: {
  open: boolean;
  onClose: () => void;
  purchaseInvoiceId: string;
  currency: string;
  onRecorded?: () => void;
}) {
  const [history, setHistory] = useState<SupplierPaymentHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('Bank');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await purchaseService.getSupplierPaymentHistory(purchaseInvoiceId);
      setHistory(fetched);
      setAmount(fetched.totals.outstanding > 0 ? String(fetched.totals.outstanding) : '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payments');
    } finally {
      setLoading(false);
    }
  }, [purchaseInvoiceId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const outstanding = history?.totals.outstanding ?? 0;
  const numeric = Number(amount);
  const overpaying = numeric > outstanding + 0.005;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await purchaseService.recordSupplierPayment(purchaseInvoiceId, {
        amount: numeric,
        mode,
        referenceNumber: reference.trim() || null,
      });
      setReference('');
      await load();
      onRecorded?.();
      const refreshed = await purchaseService.getSupplierPaymentHistory(purchaseInvoiceId);
      // Stay open on a part-payment: another usually follows.
      if (refreshed.totals.outstanding <= 0.005) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record the payment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Supplier payments"
      description={
        history
          ? `${history.purchaseInvoice.documentNumber} · ${history.purchaseInvoice.supplierName}`
          : undefined
      }
    >
      <div className="space-y-5">
        {loading && !history ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : (
          history && (
            <>
              <div className="grid grid-cols-3 gap-3 rounded-md border p-3 text-sm">
                <Figure
                  label="Bill"
                  value={formatMoney(history.purchaseInvoice.grandTotal, currency)}
                />
                <Figure label="Paid" value={formatMoney(history.totals.received, currency)} />
                <Figure
                  label="Outstanding"
                  value={formatMoney(outstanding, currency)}
                  emphasis={outstanding > 0}
                />
              </div>

              {history.payments.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">History</p>
                  <ul className="max-h-40 space-y-1 overflow-auto">
                    {history.payments.map((payment) => (
                      <li
                        key={payment._id}
                        className="flex items-center justify-between rounded border px-2.5 py-1.5 text-sm"
                      >
                        <span className="flex items-center gap-2">
                          {/* A refund from the supplier is money coming back —
                              it must not read as another payment out. */}
                          {payment.isReversal && (
                            <RotateCcw className="h-3.5 w-3.5 text-emerald-600" />
                          )}
                          <Badge variant="outline" className="text-[10px]">
                            {payment.mode}
                          </Badge>
                          <span className="text-muted-foreground">
                            {formatDate(payment.date)}
                          </span>
                          {payment.referenceNumber && (
                            <span className="text-xs text-muted-foreground">
                              {payment.referenceNumber}
                            </span>
                          )}
                        </span>
                        <span
                          className={cn(
                            'tabular-nums',
                            payment.isReversal ? 'text-emerald-600' : 'font-medium'
                          )}
                        >
                          {payment.isReversal ? '+ ' : ''}
                          {formatMoney(payment.amount, currency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {outstanding > 0.005 ? (
                <div className="space-y-3 border-t pt-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="pay-amount">Amount paid</Label>
                      <Input
                        id="pay-amount"
                        type="number"
                        min="0"
                        step="any"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pay-mode">Mode</Label>
                      <select
                        id="pay-mode"
                        value={mode}
                        onChange={(e) => setMode(e.target.value as PaymentMode)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        {MODES.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {NEEDS_REFERENCE.includes(mode) && (
                    <div className="space-y-1.5">
                      <Label htmlFor="pay-reference">
                        {mode === 'Cheque' ? 'Cheque number' : 'Reference'}
                      </Label>
                      <Input
                        id="pay-reference"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        placeholder="UTR / transaction id, for reconciliation"
                      />
                    </div>
                  )}

                  {overpaying && (
                    <p className="text-xs text-destructive">
                      Only {formatMoney(outstanding, currency)} is outstanding on this bill.
                    </p>
                  )}
                </div>
              ) : (
                <p className="border-t pt-4 text-sm text-muted-foreground">
                  This bill is fully settled.
                </p>
              )}
            </>
          )
        )}

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {outstanding > 0.005 && (
            <Button disabled={submitting || !(numeric > 0) || overpaying} onClick={submit}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record payment
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Figure({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('tabular-nums', emphasis ? 'font-semibold' : '')}>{value}</p>
    </div>
  );
}
