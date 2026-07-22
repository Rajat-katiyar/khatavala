import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, IndianRupee, Loader2, PackageCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Can } from '@/components/Can';
import { useCompanyStore } from '@/store/companyStore';
import { formatDate, formatMoney } from '@/lib/utils';
import * as purchaseService from '@/services/purchase.service';
import type { PurchaseDocument, PurchaseDocumentKind } from '@/types';
import { PURCHASE_META, PurchaseStatusBadge } from './PurchaseList';
import { SupplierPaymentModal } from './SupplierPaymentModal';

/** One detail page for every purchase document — the mirror of the sales side. */
export function PurchaseDetail({ kind }: { kind: PurchaseDocumentKind }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';
  const meta = PURCHASE_META[kind];

  const [document, setDocument] = useState<PurchaseDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDocument(await purchaseService.getDocument(kind, id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the document');
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !document) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }
  if (!document) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
        {error ?? 'Not found'}
      </p>
    );
  }

  const outstanding =
    Math.round((document.grandTotal - (document.amountPaid ?? 0)) * 100) / 100;
  const isPostedBill =
    kind === 'invoices' && ['Unpaid', 'PartiallyPaid', 'Paid'].includes(document.status);

  const run = async (key: string, action: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (success) setNotice(success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to={meta.path}>
              <ArrowLeft className="mr-2 h-4 w-4" /> {meta.plural}
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{document.documentNumber}</h1>
            <PurchaseStatusBadge status={document.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {document.supplierName} · {formatDate(document.date)}
            {document.supplierInvoiceNumber && ` · their ref ${document.supplierInvoiceNumber}`}
            {document.purchaseOrderNumber && ` · from ${document.purchaseOrderNumber}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {kind === 'grn' && document.status === 'Draft' && (
            <Can permission="purchases.update">
              <Button
                disabled={busy === 'receive'}
                onClick={() =>
                  run(
                    'receive',
                    () => purchaseService.receiveGrn(document._id),
                    'Goods received — stock has been taken in.'
                  )
                }
              >
                {busy === 'receive' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <PackageCheck className="mr-2 h-4 w-4" />
                )}
                Receive goods
              </Button>
            </Can>
          )}

          {kind === 'grn' && document.status === 'Received' && !document.purchaseInvoiceId && (
            <Can permission="purchases.create">
              <Button
                variant="outline"
                disabled={busy === 'bill'}
                onClick={() =>
                  run('bill', async () => {
                    const bill = await purchaseService.convertGrnToInvoice(document._id);
                    navigate(`/purchase/invoices/${bill._id}`);
                  })
                }
              >
                <ArrowRight className="mr-2 h-4 w-4" /> Create bill
              </Button>
            </Can>
          )}

          {kind === 'orders' &&
            ['Draft', 'Sent', 'Confirmed', 'PartiallyReceived'].includes(document.status) && (
              <Can permission="purchases.create">
                <Button
                  variant="outline"
                  disabled={busy === 'grn'}
                  onClick={() =>
                    run('grn', async () => {
                      const grn = await purchaseService.convertOrderToGrn(document._id);
                      navigate(`/purchase/grn/${grn._id}`);
                    })
                  }
                >
                  <ArrowRight className="mr-2 h-4 w-4" /> Receive against this
                </Button>
              </Can>
            )}

          {kind === 'invoices' && document.status === 'Draft' && (
            <Can permission="purchases.update">
              <Button
                disabled={busy === 'confirm'}
                onClick={() =>
                  run(
                    'confirm',
                    () => purchaseService.confirmPurchaseInvoice(document._id),
                    'Bill confirmed — the payable has been posted.'
                  )
                }
              >
                {busy === 'confirm' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm bill
              </Button>
            </Can>
          )}

          {isPostedBill && outstanding > 0 && (
            <Can permission="purchases.update">
              <Button onClick={() => setPaymentOpen(true)}>
                <IndianRupee className="mr-2 h-4 w-4" /> Record payment
              </Button>
            </Can>
          )}

          {isPostedBill && (
            <Can permission="purchases.delete">
              <Button asChild variant="outline">
                <Link to={`/purchase/returns/new?invoiceId=${document._id}`}>Return</Link>
              </Button>
            </Can>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                {kind === 'grn' && <TableHead className="text-right">Ordered</TableHead>}
                <TableHead className="text-right">
                  {kind === 'grn' ? 'Received' : 'Qty'}
                </TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {document.lineItems.map((line, index) => (
                <TableRow key={line._id ?? index}>
                  <TableCell>
                    <div className="font-medium">{line.name}</div>
                    {line.sku && (
                      <div className="text-xs text-muted-foreground">{line.sku}</div>
                    )}
                  </TableCell>
                  {kind === 'grn' && (
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {line.orderedQuantity ?? '—'}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">
                    {line.quantity}
                    {/* A short receipt is a fact worth surfacing on the record,
                        not just while typing it. */}
                    {kind === 'grn' &&
                      typeof line.orderedQuantity === 'number' &&
                      line.quantity < line.orderedQuantity && (
                        <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">
                          short
                        </span>
                      )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(line.unitPrice, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {line.gstPercent ? `${line.gstPercent}%` : '—'}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatMoney(line.lineTotal, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-xs space-y-1.5 text-sm">
              <Row label="Subtotal" value={formatMoney(document.subTotal, currency)} />
              {document.totalDiscount > 0 && (
                <Row
                  label="Discount"
                  value={`- ${formatMoney(document.totalDiscount, currency)}`}
                />
              )}
              <Row label="GST" value={formatMoney(document.totalTax, currency)} />
              {document.roundOff !== 0 && (
                <Row label="Round off" value={formatMoney(document.roundOff, currency)} />
              )}
              <div className="flex items-center justify-between border-t pt-2 text-base font-semibold">
                <span>Total</span>
                <span className="tabular-nums">
                  {formatMoney(document.grandTotal, currency)}
                </span>
              </div>
              {kind === 'invoices' && (document.returnedAmount ?? 0) > 0 && (
                <Row
                  label="Returned"
                  value={`- ${formatMoney(document.returnedAmount ?? 0, currency)}`}
                />
              )}
              {kind === 'invoices' && (document.amountPaid ?? 0) > 0 && (
                <>
                  <Row
                    label="Paid"
                    value={`- ${formatMoney(document.amountPaid ?? 0, currency)}`}
                  />
                  <div className="flex items-center justify-between font-medium">
                    <span>Balance due</span>
                    <span className="tabular-nums">{formatMoney(outstanding, currency)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {kind === 'invoices' && (
        <SupplierPaymentModal
          open={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          purchaseInvoiceId={document._id}
          currency={currency}
          onRecorded={load}
        />
      )}
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
