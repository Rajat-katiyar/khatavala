import { useCallback, useEffect, useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import * as productService from '@/services/product.service';
import { SYMBOLOGIES, type Product, type Symbology } from '@/types';

/**
 * Barcode label sheet preview and print.
 *
 * The sheet is rendered server-side as SVG and shown inline. Printing opens a
 * window containing just that SVG rather than using `window.print()` on this
 * page — printing the app would carry the nav, filters and modal chrome onto
 * the label sheet, and @media print rules to strip all that are far more
 * fragile than handing the printer a document that contains only labels.
 */
export function BarcodePrintModal({
  open,
  onOpenChange,
  products,
  currency,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  currency: string;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [symbology, setSymbology] = useState<Symbology>('code128');
  const [columns, setColumns] = useState(3);
  const [showName, setShowName] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [svg, setSvg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // One label per product by default; reset each time so a previous
    // selection's quantities never carry over.
    setQuantities(Object.fromEntries(products.map((p) => [p._id, 1])));
    setSvg(null);
    setError(null);
  }, [open, products]);

  const totalLabels = products.reduce((sum, p) => sum + (quantities[p._id] ?? 1), 0);

  const preview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSvg(
        await productService.renderBarcodeSheet({
          items: products.map((p) => ({ productId: p._id, quantity: quantities[p._id] ?? 1 })),
          symbology,
          columns,
          showName,
          showPrice,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the barcode sheet');
      setSvg(null);
    } finally {
      setLoading(false);
    }
  }, [products, quantities, symbology, columns, showName, showPrice]);

  // Regenerate whenever an option changes, so the preview always matches what
  // would print.
  useEffect(() => {
    if (!open || products.length === 0) return;
    const timer = setTimeout(() => void preview(), 250);
    return () => clearTimeout(timer);
  }, [open, products.length, preview]);

  const handlePrint = () => {
    if (!svg) return;
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) {
      setError('Your browser blocked the print window. Allow pop-ups for this site.');
      return;
    }
    win.document.write(
      `<!doctype html><html><head><title>Barcode labels</title>
       <style>
         @page { margin: 8mm; }
         body { margin: 0; }
         svg { width: 100%; height: auto; }
       </style></head><body>${svg}</body></html>`
    );
    win.document.close();
    // Wait for layout before printing, or the sheet can print blank.
    win.onload = () => {
      win.focus();
      win.print();
    };
  };

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title="Print barcode labels"
      description={`${products.length} product(s) selected — ${totalLabels} label(s)`}
      className="max-w-4xl"
    >
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="b-symbology">Symbology</Label>
            <select
              id="b-symbology"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={symbology}
              onChange={(e) => setSymbology(e.target.value as Symbology)}
            >
              {SYMBOLOGIES.map((s) => (
                <option key={s} value={s}>
                  {s.toUpperCase()}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Code 128 encodes any SKU. EAN and UPC need fixed-length digits.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="b-columns">Labels across</Label>
            <Input
              id="b-columns"
              type="number"
              min={1}
              max={5}
              value={columns}
              onChange={(e) => setColumns(Math.min(5, Math.max(1, Number(e.target.value) || 1)))}
            />
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={showName}
                onChange={(e) => setShowName(e.target.checked)}
              />
              Show product name
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={showPrice}
                onChange={(e) => setShowPrice(e.target.checked)}
              />
              Show price
            </label>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Copies per product</p>
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {products.map((product) => (
                <div key={product._id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm" title={product.name}>
                    {product.name}
                  </span>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    aria-label={`Copies of ${product.name}`}
                    className="h-8 w-20"
                    value={quantities[product._id] ?? 1}
                    onChange={(e) =>
                      setQuantities((prev) => ({
                        ...prev,
                        [product._id]: Math.min(500, Math.max(1, Number(e.target.value) || 1)),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Labels encode the barcode, or the SKU when no barcode is set. Prices shown in{' '}
              {currency}.
            </p>
          </div>
        </div>

        {/* Deliberately white in BOTH themes: this is a WYSIWYG preview of a
            printed sheet, and barcodes must be dark bars on a light ground to
            scan. Theming this panel would misrepresent what comes out of the
            printer — and inverted bars do not scan at all. */}
        <div className="min-h-[320px] rounded-md border bg-white p-3">
          {loading ? (
            <p className="flex items-center justify-center py-20 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating…
            </p>
          ) : error ? (
            <p role="alert" className="p-4 text-sm text-destructive">
              {error}
            </p>
          ) : svg ? (
            <div
              className="max-h-[420px] overflow-auto [&_svg]:h-auto [&_svg]:w-full"
              // The SVG is generated by our own API from our own data — not
              // user-authored markup — and bwip-js emits paths and text only.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className="py-20 text-center text-sm text-muted-foreground">
              Select products to preview their labels.
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button onClick={handlePrint} disabled={!svg || loading}>
          <Printer className="mr-2 h-4 w-4" />
          Print {totalLabels} label(s)
        </Button>
      </div>
    </Modal>
  );
}
