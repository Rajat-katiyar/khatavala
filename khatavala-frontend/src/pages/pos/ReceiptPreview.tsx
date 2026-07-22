import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, FileText, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as salesService from '@/services/sales.service';
import type { PosCheckoutResult, Receipt } from '@/types';

/**
 * Thermal receipt, 80 mm.
 *
 * The printable area of an 80 mm roll is ~72 mm, which is what `RECEIPT_WIDTH`
 * targets. The layout is deliberately plain — monospace, no colour, no
 * backgrounds — because a thermal head prints one colour by burning paper:
 * anything relying on grey or a fill either disappears or comes out as a solid
 * black block that wastes the ribbon and the roll.
 *
 * The `@media print` block is what actually reaches the printer. It hides the
 * whole app and prints this element alone at the roll's width, so the browser's
 * default A4 page setup does not scale a 72 mm receipt onto a sheet.
 */

const RECEIPT_WIDTH = '72mm';

export function ReceiptPreview({
  result,
  currency,
  onNewSale,
}: {
  result: PosCheckoutResult;
  currency: string;
  onNewSale: () => void;
}) {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    // Fetched rather than assembled from the checkout response: the receipt
    // needs the shop's own GSTIN and address, which the till does not hold.
    salesService
      .getReceipt(result.invoice._id)
      .then(setReceipt)
      .catch(() => setReceipt(null));
  }, [result.invoice._id]);

  const invoice = receipt?.invoice ?? result.invoice;
  const company = receipt?.company;
  const payment = result.payment;

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-auto bg-muted/30">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #thermal-receipt, #thermal-receipt * { visibility: visible; }
          #thermal-receipt {
            position: absolute;
            left: 0;
            top: 0;
            width: ${RECEIPT_WIDTH};
            margin: 0;
            padding: 0;
            box-shadow: none;
            border: none;
          }
          @page { size: ${RECEIPT_WIDTH} auto; margin: 0; }
        }
      `}</style>

      <div className="flex items-center justify-between gap-3 border-b bg-background px-4 py-3 print:hidden">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
            <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          </span>
          <div>
            <p className="font-medium">Sale complete</p>
            <p className="text-xs text-muted-foreground">
              {invoice.documentNumber} · {formatMoney(invoice.grandTotal, currency)}
              {result.change > 0 && ` · change ${formatMoney(result.change, currency)}`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
          <Button asChild variant="outline">
            <Link to={`/sales/invoices/${invoice._id}`}>
              <FileText className="mr-2 h-4 w-4" /> Invoice
            </Link>
          </Button>
          {/* Autofocused so Enter — or the scanner's terminator — starts the
              next sale without the operator reaching for the mouse. */}
          <Button autoFocus onClick={onNewSale}>
            New sale
          </Button>
        </div>
      </div>

      <div className="flex flex-1 justify-center p-6 print:p-0">
        <div
          id="thermal-receipt"
          style={{ width: RECEIPT_WIDTH }}
          className="bg-white p-3 font-mono text-[11px] leading-tight text-black shadow-sm print:shadow-none"
        >
          <div className="text-center">
            <p className="text-[13px] font-bold uppercase">
              {company?.name ?? activeCompany?.name ?? 'Receipt'}
            </p>
            {company?.address?.line1 && <p>{company.address.line1}</p>}
            {(company?.address?.city || company?.state) && (
              <p>{[company?.address?.city, company?.state].filter(Boolean).join(', ')}</p>
            )}
            {company?.gstNumber && <p>GSTIN: {company.gstNumber}</p>}
          </div>

          <Divider />

          <div className="flex justify-between">
            <span>{invoice.documentNumber}</span>
            <span>{new Date(invoice.date).toLocaleDateString('en-IN')}</span>
          </div>
          <div className="flex justify-between">
            <span className="truncate">{invoice.customerName}</span>
            <span>{new Date(invoice.date).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
            })}</span>
          </div>

          <Divider />

          {/* Item name on its own line, figures beneath: at 72 mm a four-column
              row wraps and becomes unreadable. */}
          {invoice.lineItems.map((line, index) => (
            <div key={line._id ?? index} className="mb-1">
              <p className="truncate">{line.name}</p>
              <div className="flex justify-between">
                <span>
                  {line.quantity} x {line.unitPrice.toFixed(2)}
                  {line.gstPercent > 0 && ` (${line.gstPercent}%)`}
                </span>
                <span>{line.lineTotal.toFixed(2)}</span>
              </div>
            </div>
          ))}

          <Divider />

          <Line label="Subtotal" value={invoice.subTotal.toFixed(2)} />
          {invoice.totalDiscount > 0 && (
            <Line label="Discount" value={`-${invoice.totalDiscount.toFixed(2)}`} />
          )}
          <Line label="GST" value={invoice.totalTax.toFixed(2)} />
          {invoice.roundOff !== 0 && (
            <Line label="Round off" value={invoice.roundOff.toFixed(2)} />
          )}

          <Divider />

          <div className="flex justify-between text-[13px] font-bold">
            <span>TOTAL</span>
            <span>{invoice.grandTotal.toFixed(2)}</span>
          </div>

          {payment && (
            <>
              <Line label={`Paid (${payment.mode})`} value={payment.amount.toFixed(2)} />
              {result.change > 0 && (
                <Line label="Change" value={result.change.toFixed(2)} />
              )}
            </>
          )}
          {invoice.grandTotal - (invoice.amountPaid ?? 0) > 0.005 && (
            <Line
              label="Balance due"
              value={(invoice.grandTotal - (invoice.amountPaid ?? 0)).toFixed(2)}
            />
          )}

          <Divider />

          <p className="text-center">Thank you — please visit again</p>
          <p className="mt-1 text-center text-[9px]">
            Goods once sold are returnable per store policy
          </p>
        </div>
      </div>
    </div>
  );
}

/** Dashes rather than a border: a thermal printer renders a rule unevenly. */
const Divider = () => <p className="my-1 overflow-hidden">{'-'.repeat(42)}</p>;

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
