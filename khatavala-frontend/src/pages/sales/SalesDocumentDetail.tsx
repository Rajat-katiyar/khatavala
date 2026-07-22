import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Download,
  IndianRupee,
  Loader2,
  Send,
  Mail,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react';
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
import { Modal } from '@/components/ui/modal';
import { Can } from '@/components/Can';
import { useCompanyStore } from '@/store/companyStore';
import { formatDate, formatMoney } from '@/lib/utils';
import * as salesService from '@/services/sales.service';
import * as notifService from '@/services/notification.service';
import type { SalesDocumentDetail as Detail, SalesDocumentKind, SalesLineItem } from '@/types';
import { KIND_META, StatusBadge } from './SalesParts';
import { PaymentModal } from './PaymentModal';

export function SalesDocumentDetail({ kind }: { kind: SalesDocumentKind }) {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';
  const meta = KIND_META[kind];

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  // Notification Send Modal state
  const [sendOpen, setSendOpen] = useState(false);
  const [sendChannel, setSendChannel] = useState<'email' | 'whatsapp' | 'sms'>('email');
  const [sendRecipient, setSendRecipient] = useState('');
  const [sendingNotif, setSendingNotif] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await salesService.getDocument(kind, id);
      setDetail(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document not found');
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, action: () => Promise<unknown>, successMsg?: string) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      if (successMsg) setNotice(successMsg);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{error ?? 'Not found'}</p>
        <Button variant="outline" size="sm" asChild>
          <Link to={meta.path}>Back to {meta.plural.toLowerCase()}</Link>
        </Button>
      </div>
    );
  }

  const { document } = detail;
  const items: SalesLineItem[] = document.lineItems || [];
  const isPosted = document.status !== 'Draft' && document.status !== 'Cancelled';
  const balanceDue = document.grandTotal - (document.amountPaid ?? 0);

  const subtotal = document.subTotal;

  const convertNext = async () => {
    if (kind === 'quotations') {
      const order = await salesService.convertQuotationToOrder(document._id);
      navigate(`/sales/orders/${order._id}`);
    } else {
      const inv = await salesService.convertOrderToInvoice(document._id);
      navigate(`/sales/invoices/${inv._id}`);
    }
  };

  const openSendModal = () => {
    setSendRecipient('');
    setSendOpen(true);
  };

  const handleSendNotification = async () => {
    setSendingNotif(true);
    setError(null);
    try {
      const res = await notifService.sendInvoiceNotification({
        invoiceId: document._id,
        channel: sendChannel,
        recipient: sendRecipient || undefined,
      });

      if (res.success) {
        setNotice(`Invoice sent successfully via ${sendChannel.toUpperCase()}!`);
        setSendOpen(false);
      } else {
        setError(res.error || 'Failed to send notification');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send notification');
    } finally {
      setSendingNotif(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to={meta.path}>
              <ArrowLeft className="mr-2 h-4 w-4" /> {meta.plural}
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{document.documentNumber}</h1>
            <StatusBadge status={document.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {document.customerName} · {formatDate(document.date)}
            {document.dueDate && ` · due ${formatDate(document.dueDate)}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {kind !== 'invoices' && (
            <Can permission="sales.create">
              <Button
                variant="outline"
                disabled={busy === 'convert'}
                onClick={() => run('convert', convertNext)}
              >
                {busy === 'convert' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="mr-2 h-4 w-4" />
                )}
                {kind === 'quotations' ? 'Convert to order' : 'Convert to invoice'}
              </Button>
            </Can>
          )}

          {kind === 'invoices' && (
            <>
              {document.status === 'Draft' && (
                <Can permission="sales.update">
                  <Button
                    disabled={busy === 'confirm'}
                    onClick={() =>
                      run(
                        'confirm',
                        () => salesService.confirmInvoice(document._id),
                        'Invoice confirmed — stock deducted and the ledger posted.'
                      )
                    }
                  >
                    {busy === 'confirm' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Confirm
                  </Button>
                </Can>
              )}

              <Button
                variant="outline"
                disabled={busy === 'pdf'}
                onClick={() =>
                  run('pdf', () =>
                    salesService.downloadInvoicePdf(document._id, document.documentNumber)
                  )
                }
              >
                {busy === 'pdf' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Download PDF
              </Button>

              <Button variant="outline" onClick={openSendModal}>
                <Send className="mr-2 h-4 w-4" />
                Send Invoice
              </Button>

              {isPosted && balanceDue > 0 && (
                <Can permission="sales.update">
                  <Button onClick={() => setPaymentOpen(true)}>
                    <IndianRupee className="mr-2 h-4 w-4" /> Record payment
                  </Button>
                </Can>
              )}

              {isPosted && (
                <Can permission="sales.void">
                  <Button variant="outline" onClick={() => setCancelOpen(true)}>
                    <Ban className="mr-2 h-4 w-4" /> Cancel
                  </Button>
                </Can>
              )}
            </>
          )}
        </div>
      </div>

      {notice && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{notice}</span>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Main details table & cards */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Line Items</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <span className="font-medium">{item.sku || 'Item'}</span>
                    </TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">{formatMoney(item.unitPrice, currency)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatMoney(item.lineTotal, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Summary Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatMoney(subtotal, currency)}</span>
            </div>
            {document.totalTax > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Tax</span>
                <span className="tabular-nums">{formatMoney(document.totalTax, currency)}</span>
              </div>
            )}
            <div className="border-t pt-2 font-bold flex justify-between text-base">
              <span>Grand Total</span>
              <span>{formatMoney(document.grandTotal, currency)}</span>
            </div>
            {kind === 'invoices' && (
              <div className="flex justify-between text-xs text-muted-foreground pt-1">
                <span>Balance Due</span>
                <span className="font-semibold text-amber-600 dark:text-amber-400">
                  {formatMoney(balanceDue, currency)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Record Payment Modal */}
      {paymentOpen && (
        <PaymentModal
          open={paymentOpen}
          onClose={() => setPaymentOpen(false)}
          invoiceId={document._id}
          currency={currency}
          onRecorded={() => {
            setPaymentOpen(false);
            setNotice('Payment recorded successfully!');
            void load();
          }}
        />
      )}

      {/* Send Invoice Modal */}
      <Modal
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title={`Send Invoice ${document.documentNumber}`}
        description="Deliver tax invoice PDF to customer via Email, WhatsApp, or SMS."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Select Channel</Label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setSendChannel('email')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-colors ${
                  sendChannel === 'email' ? 'border-primary bg-primary/10 text-primary font-semibold' : 'hover:bg-muted'
                }`}
              >
                <Mail className="w-4 h-4" /> Email
              </button>
              <button
                type="button"
                onClick={() => setSendChannel('whatsapp')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-colors ${
                  sendChannel === 'whatsapp' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 font-semibold' : 'hover:bg-muted'
                }`}
              >
                <MessageSquare className="w-4 h-4" /> WhatsApp
              </button>
              <button
                type="button"
                onClick={() => setSendChannel('sms')}
                className={`flex items-center justify-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-colors ${
                  sendChannel === 'sms' ? 'border-amber-500 bg-amber-500/10 text-amber-600 font-semibold' : 'hover:bg-muted'
                }`}
              >
                <Send className="w-4 h-4" /> SMS
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{sendChannel === 'email' ? 'Recipient Email Address' : 'Recipient Phone Number'}</Label>
            <Input
              value={sendRecipient}
              onChange={(e) => setSendRecipient(e.target.value)}
              placeholder={sendChannel === 'email' ? 'customer@example.com' : '+919876543210'}
            />
            <p className="text-[11px] text-muted-foreground">
              Leave blank to automatically use customer profile defaults.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setSendOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendNotification} disabled={sendingNotif} className="gap-2">
              {sendingNotif ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Send Invoice PDF
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cancel Invoice Modal */}
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this invoice?"
        description="Stock goes back and the customer is credited. The invoice stays on record as cancelled — it is never deleted."
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Input
              id="reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Why is this being cancelled?"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={busy === 'cancel' || cancelReason.trim().length < 3}
              onClick={async () => {
                await run(
                  'cancel',
                  () => salesService.cancelInvoice(document._id, cancelReason.trim()),
                  'Invoice cancelled — stock returned and the customer credited.'
                );
                setCancelOpen(false);
                setCancelReason('');
              }}
            >
              {busy === 'cancel' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Cancel invoice
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
