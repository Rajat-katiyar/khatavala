import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import * as salesService from '@/services/sales.service';
import type { PaymentHistory, PaymentMode } from '@/types';

/**
 * Record a payment, with the invoice's payment history above the form.
 *
 * The history is not decoration: the first question anyone asks before taking
 * money is "what have they already paid?", and answering it in the same dialog
 * is what stops a second cashier taking the same payment twice.
 *
 * Reusable — the invoice detail page mounts it, and so can any future
 * receivables screen.
 */

export const PAYMENT_MODES: PaymentMode[] = ['Cash', 'UPI', 'Card', 'Bank', 'Cheque'];

/** Modes where a reference number is worth capturing for reconciliation. */
const NEEDS_REFERENCE: PaymentMode[] = ['UPI', 'Card', 'Bank', 'Cheque'];

export function PaymentModal({
  open,
  onClose,
  invoiceId,
  currency,
  onRecorded,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
  currency: string;
  onRecorded?: () => void;
}) {
  const [history, setHistory] = useState<PaymentHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<PaymentMode>('Cash');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await salesService.getPaymentHistory(invoiceId);
      setHistory(fetched);
      // Prefill the full outstanding — settling in full is the common case, and
      // the operator can still type over it.
      setAmount(fetched.totals.outstanding > 0 ? String(fetched.totals.outstanding) : '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load payments');
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

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
      await salesService.recordPayment(invoiceId, {
        amount: numeric,
        mode,
        referenceNumber: reference.trim() || null,
      });
      setReference('');
      await load();
      onRecorded?.();
      // Closing only once the invoice is settled: a part-payment usually means
      // another is coming, and reopening the dialog to take it is friction.
      const refreshed = await salesService.getPaymentHistory(invoiceId);
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
      title="Payments"
      description={
        history
          ? `${history.invoice.documentNumber} · ${history.invoice.customerName}`
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
                <Figure label="Invoice" value={formatMoney(history.invoice.grandTotal, currency)} />
                <Figure label="Received" value={formatMoney(history.totals.received, currency)} />
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
                          {/* A refund is money OUT — it must not read as another
                              receipt in a list of receipts. */}
                          {payment.isReversal && (
                            <RotateCcw className="h-3.5 w-3.5 text-destructive" />
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
                            payment.isReversal ? 'text-destructive' : 'font-medium'
                          )}
                        >
                          {payment.isReversal ? '- ' : ''}
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
                      <Label htmlFor="pay-amount">Amount</Label>
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
                        {PAYMENT_MODES.map((option) => (
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
                        Reference {mode === 'Cheque' ? 'number' : 'ID'}
                      </Label>
                      <Input
                        id="pay-reference"
                        value={reference}
                        onChange={(e) => setReference(e.target.value)}
                        placeholder={
                          mode === 'UPI' ? 'UPI transaction id' : 'For reconciliation'
                        }
                      />
                    </div>
                  )}

                  {overpaying && (
                    <p className="text-xs text-destructive">
                      Only {formatMoney(outstanding, currency)} is outstanding.
                    </p>
                  )}
                </div>
              ) : (
                <p className="border-t pt-4 text-sm text-muted-foreground">
                  This invoice is fully settled.
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
            <Button
              disabled={submitting || !(numeric > 0) || overpaying}
              onClick={submit}
            >
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
