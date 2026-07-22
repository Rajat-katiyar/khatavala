import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineItemEditor,
  TotalsPanel,
  documentTotals,
  type EditorLine,
} from '@/components/LineItemEditor';
import { ProductPicker } from '@/pages/inventory/InventoryParts';
import { useCompanyStore } from '@/store/companyStore';
import * as purchaseService from '@/services/purchase.service';
import * as supplierService from '@/services/supplier.service';
import type { Product, PurchaseDocumentKind, Supplier } from '@/types';

/**
 * One form for purchase orders, goods receipts and bills.
 *
 * They differ only in which extra header fields they carry and what happens on
 * save, so a single component covers all three — the same call the backend
 * makes with one shared document service.
 *
 * The product picker and the line-item grid are the ones the sales side uses;
 * the buying side does not get a second implementation of either.
 */

type FormKind = Extract<PurchaseDocumentKind, 'orders' | 'grn' | 'invoices'>;

const META: Record<FormKind, { title: string; noun: string; path: string }> = {
  orders: { title: 'New purchase order', noun: 'order', path: '/purchase/orders' },
  grn: { title: 'New goods receipt', noun: 'receipt', path: '/purchase/grn' },
  invoices: { title: 'New purchase bill', noun: 'bill', path: '/purchase/invoices' },
};

export function PurchaseForm({ kind }: { kind: FormKind }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';
  const meta = META[kind];

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierResults, setSupplierResults] = useState<Supplier[]>([]);
  const [searchingSupplier, setSearchingSupplier] = useState(false);

  const [lines, setLines] = useState<EditorLine[]>([]);
  const [picking, setPicking] = useState<Product | null>(null);

  const [expectedDate, setExpectedDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [supplierDocumentNumber, setSupplierDocumentNumber] = useState('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [receivesStock, setReceivesStock] = useState(kind === 'invoices');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Arriving with ?fromOrder= or ?fromGrn= means the server has already built
   * the next document; this form only has to show it. Conversions happen
   * server-side so the line provenance (`sourceLineItemId`) survives — that is
   * what makes "how much of this order is still outstanding" answerable.
   */
  const prefill = useCallback(async () => {
    const fromOrder = params.get('fromOrder');
    const fromGrn = params.get('fromGrn');
    if (!fromOrder && !fromGrn) return;

    setLoading(true);
    setError(null);
    try {
      if (kind === 'grn' && fromOrder) {
        const draft = await purchaseService.convertOrderToGrn(fromOrder);
        navigate(`/purchase/grn/${draft._id}`, { replace: true });
        return;
      }
      if (kind === 'invoices' && fromGrn) {
        const bill = await purchaseService.convertGrnToInvoice(fromGrn);
        navigate(`/purchase/invoices/${bill._id}`, { replace: true });
        return;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the document');
    } finally {
      setLoading(false);
    }
  }, [params, kind, navigate]);

  useEffect(() => {
    void prefill();
  }, [prefill]);

  useEffect(() => {
    if (!supplierQuery.trim() || supplier) {
      setSupplierResults([]);
      return;
    }
    let cancelled = false;
    setSearchingSupplier(true);
    const timer = setTimeout(async () => {
      try {
        const page = await supplierService.listSuppliers({ search: supplierQuery, limit: 8 });
        if (!cancelled) setSupplierResults(page.suppliers);
      } finally {
        if (!cancelled) setSearchingSupplier(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [supplierQuery, supplier]);

  const addProduct = (product: Product | null) => {
    if (!product) return;
    setLines((current) => [
      ...current,
      {
        key: `${product._id}-${current.length}`,
        product,
        quantity: 1,
        // Seeded from the last purchase price as a STARTING POINT — the user is
        // expected to type the supplier's actual rate. The API requires it and
        // applies no default of its own, deliberately: billing at last
        // quarter's rate would be wrong more often than right.
        unitPrice: product.purchasePrice ?? 0,
        discountPercent: 0,
        gstPercent: product.gstPercentage ?? 0,
      },
    ]);
    setPicking(null);
  };

  const totals = useMemo(() => documentTotals(lines), [lines]);
  const canSubmit = !!supplier && lines.length > 0 && !submitting;

  const submit = async () => {
    if (!supplier || lines.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const document = await purchaseService.createDocument(kind, {
        supplierId: supplier._id,
        lineItems: lines.map((line) => ({
          productId: line.product._id,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountPercent: line.discountPercent,
          gstPercent: line.gstPercent,
        })),
        ...(kind === 'orders' && expectedDate ? { expectedDate } : {}),
        ...(kind === 'grn' && supplierDocumentNumber
          ? { supplierDocumentNumber }
          : {}),
        ...(kind === 'invoices'
          ? {
              supplierInvoiceNumber: supplierInvoiceNumber || null,
              receivesStock,
              dueDate: dueDate || null,
            }
          : {}),
        notes: notes.trim() || null,
      });
      navigate(`${meta.path}/${document._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not create the ${meta.noun}`);
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Preparing…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
          <Link to={meta.path}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Link>
        </Button>
        <h1 className="text-2xl font-semibold">{meta.title}</h1>
        <p className="text-sm text-muted-foreground">
          {kind === 'orders' && 'What we are asking the supplier to send. Moves no stock.'}
          {kind === 'grn' && 'What actually arrived. Receiving it takes the goods into stock.'}
          {kind === 'invoices' &&
            'The supplier’s bill. Posts the payable; takes stock in only if no receipt did.'}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProductPicker value={picking} onSelect={addProduct} disabled={submitting} />
              <LineItemEditor
                lines={lines}
                currency={currency}
                showOrdered={kind === 'grn'}
                onChange={(key, patch) =>
                  setLines((current) =>
                    current.map((line) => (line.key === key ? { ...line, ...patch } : line))
                  )
                }
                onRemove={(key) =>
                  setLines((current) => current.filter((line) => line.key !== key))
                }
                emptyMessage="Search for a product above to add the first line."
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Supplier</CardTitle>
            </CardHeader>
            <CardContent>
              {supplier ? (
                <div className="flex items-center justify-between rounded-md border border-input px-3 py-2 text-sm">
                  <span>
                    {supplier.name}
                    <span className="text-muted-foreground"> · {supplier.phone}</span>
                  </span>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline"
                    onClick={() => setSupplier(null)}
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={supplierQuery}
                    onChange={(e) => setSupplierQuery(e.target.value)}
                    placeholder="Search supplier…"
                    className="pl-8"
                  />
                  {searchingSupplier && (
                    <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  {supplierResults.length > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-background shadow-md">
                      {supplierResults.map((option) => (
                        <li key={option._id}>
                          <button
                            type="button"
                            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                            onClick={() => {
                              setSupplier(option);
                              setSupplierQuery('');
                            }}
                          >
                            <span>{option.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {option.phone}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Totals</CardTitle>
            </CardHeader>
            <CardContent>
              <TotalsPanel totals={totals} currency={currency} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {kind === 'orders' && (
                <div className="space-y-1.5">
                  <Label htmlFor="expected">Expected delivery</Label>
                  <Input
                    id="expected"
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                  />
                </div>
              )}

              {kind === 'grn' && (
                <div className="space-y-1.5">
                  <Label htmlFor="supplier-doc">Supplier delivery note</Label>
                  <Input
                    id="supplier-doc"
                    value={supplierDocumentNumber}
                    onChange={(e) => setSupplierDocumentNumber(e.target.value)}
                    placeholder="Their document number"
                  />
                </div>
              )}

              {kind === 'invoices' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="supplier-invoice">Supplier invoice number</Label>
                    <Input
                      id="supplier-invoice"
                      value={supplierInvoiceNumber}
                      onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                      placeholder="Needed for GST input credit"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="due">Payment due</Label>
                    <Input
                      id="due"
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </div>
                  <label className="flex items-start gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={receivesStock}
                      onChange={(e) => setReceivesStock(e.target.checked)}
                      className="mt-0.5 h-4 w-4"
                    />
                    <span>
                      This bill also brings the goods in
                      <span className="block text-xs text-muted-foreground">
                        Leave off if a goods receipt already took the stock —
                        otherwise the same delivery is counted twice.
                      </span>
                    </span>
                  </label>
                </>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => navigate(meta.path)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={!canSubmit} onClick={submit}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save {meta.noun}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
