import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Plus,
  Minus,
  Check,
  CreditCard,
  Banknote,
  QrCode,
  Landmark,
  RefreshCw,
  Printer,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as salesService from '@/services/sales.service';
import * as syncService from '@/services/sync.service';
import { offlineDb } from '@/db/db';
import type { PaymentMode, PosProduct, PosCheckoutResult } from '@/types';

interface CartLine {
  product: PosProduct;
  quantity: number;
}

const round2 = (num: number) => Math.round((num + Number.EPSILON) * 100) / 100;

const PAYMENT_MODES: Array<{ mode: PaymentMode; label: string; icon: typeof Banknote }> = [
  { mode: 'Cash', label: 'Cash', icon: Banknote },
  { mode: 'UPI', label: 'UPI / QR', icon: QrCode },
  { mode: 'Card', label: 'Card', icon: CreditCard },
  { mode: 'Bank', label: 'Bank Transfer', icon: Landmark },
];

export function PosScreen() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [products, setProducts] = useState<PosProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mode, setMode] = useState<PaymentMode>('Cash');
  const [tendered, setTendered] = useState<string>('');
  const [reference, setReference] = useState('');
  const [charging, setCharging] = useState(false);
  const [completed, setCompleted] = useState<(PosCheckoutResult & { isOffline?: boolean }) | null>(null);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const loadProducts = async () => {
    setLoading(true);
    try {
      const list = await salesService.getPosProducts();
      setProducts(list);
    } catch (_err) {
      // Fallback to local Dexie.js database when offline
      const local = await offlineDb.products.toArray();
      setProducts(
        local.map((p) => ({
          _id: p._id,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          sellingPrice: p.sellingPrice,
          currentStock: p.currentStock,
          gstPercentage: p.taxRate || 18,
        })) as any
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProducts();
  }, []);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q))
    );
  }, [products, search]);

  const addToCart = (product: PosProduct) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex((line) => line.product._id === product._id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = { ...next[existingIndex], quantity: next[existingIndex].quantity + 1 };
        return next;
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.product._id !== productId) return line;
          const nextQty = line.quantity + delta;
          return nextQty > 0 ? { ...line, quantity: nextQty } : null;
        })
        .filter((line): line is CartLine => line !== null)
    );
  };

  const totals = useMemo(() => {
    let taxable = 0;
    let tax = 0;
    for (const line of cart) {
      const gross = round2(line.quantity * line.product.sellingPrice);
      taxable = round2(taxable + gross);
      tax = round2(tax + round2((gross * line.product.gstPercentage) / 100));
    }
    const beforeRounding = round2(taxable + tax);
    const grandTotal = Math.round(beforeRounding);
    return { taxable, tax, roundOff: round2(grandTotal - beforeRounding), grandTotal };
  }, [cart]);

  const tenderedNumber = Number(tendered);
  const change =
    mode === 'Cash' && tenderedNumber > totals.grandTotal
      ? round2(tenderedNumber - totals.grandTotal)
      : 0;

  const charge = async () => {
    if (cart.length === 0) return;
    setCharging(true);

    const payload = {
      lines: cart.map((line) => ({
        productId: line.product._id,
        quantity: line.quantity,
      })),
      payment: {
        mode,
        referenceNumber: reference.trim() || null,
        tendered: mode === 'Cash' && tenderedNumber > 0 ? tenderedNumber : undefined,
      },
    };

    try {
      if (!navigator.onLine) {
        throw new Error('Offline');
      }
      const result = await salesService.posCheckout(payload);
      setCompleted(result);
      setCart([]);
      setTendered('');
      setReference('');
    } catch (_err) {
      // Offline fallback: store transaction to Dexie IndexedDB pending queue
      const pendingItem = await syncService.queueOfflineTransaction('pos_checkout', payload);
      setCompleted({
        invoice: {
          _id: pendingItem.id,
          documentNumber: `INV-OFFLINE-${pendingItem.id.slice(-6).toUpperCase()}`,
          date: new Date().toISOString(),
          grandTotal: totals.grandTotal,
          paymentStatus: 'Paid',
        } as any,
        payment: { mode } as any,
        change,
        isOffline: true,
      });
      setCart([]);
      setTendered('');
      setReference('');
    } finally {
      setCharging(false);
    }
  };

  return (
    <div className="h-[calc(100vh-6.5rem)] flex flex-col md:flex-row gap-4 overflow-hidden">
      {/* Product Selection Grid */}
      <div className="flex-1 flex flex-col min-w-0 bg-card rounded-xl border p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search products by name, SKU, or scan barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
          <Button variant="outline" size="sm" onClick={loadProducts} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading quick products…</div>
          ) : filteredProducts.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filteredProducts.map((p) => (
                <button
                  key={p._id}
                  onClick={() => addToCart(p)}
                  className="group flex flex-col justify-between p-3 rounded-lg border bg-card hover:border-primary/50 hover:shadow-xs text-left transition-all relative overflow-hidden"
                >
                  <div>
                    <span className="font-semibold text-sm line-clamp-2 group-hover:text-primary transition-colors">
                      {p.name}
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">SKU: {p.sku}</p>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-2 border-t text-xs">
                    <span className="font-bold text-base text-primary">{formatMoney(p.sellingPrice, currency)}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {p.currentStock} in stock
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-muted-foreground">No products found.</div>
          )}
        </div>
      </div>

      {/* Cart & Billing Panel */}
      <div className="w-full md:w-96 bg-card rounded-xl border flex flex-col justify-between p-4 space-y-4">
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="font-bold text-base flex items-center gap-2">Current Order</h2>
          <Badge variant="secondary" className="text-xs">
            {cart.reduce((s, c) => s + c.quantity, 0)} Items
          </Badge>
        </div>

        {/* Cart Item Lines */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[140px]">
          {cart.length > 0 ? (
            cart.map((line) => (
              <div key={line.product._id} className="flex items-center justify-between p-2 rounded-lg border bg-muted/30 text-xs">
                <div className="flex-1 min-w-0 pr-2">
                  <p className="font-semibold truncate">{line.product.name}</p>
                  <p className="text-muted-foreground">{formatMoney(line.product.sellingPrice, currency)} / unit</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => updateQuantity(line.product._id, -1)}
                    className="p-1 rounded bg-muted hover:bg-muted/80"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-6 text-center font-bold">{line.quantity}</span>
                  <button
                    onClick={() => updateQuantity(line.product._id, 1)}
                    className="p-1 rounded bg-muted hover:bg-muted/80"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">Cart is empty. Tap products to add.</div>
          )}
        </div>

        {/* Totals Summary */}
        <div className="space-y-2 border-t pt-3 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>Taxable Amount</span>
            <span>{formatMoney(totals.taxable, currency)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>Total GST Tax</span>
            <span>{formatMoney(totals.tax, currency)}</span>
          </div>
          <div className="flex justify-between font-bold text-base pt-1 border-t">
            <span>Grand Total</span>
            <span className="text-primary">{formatMoney(totals.grandTotal, currency)}</span>
          </div>
        </div>

        {/* Payment Modes */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          {PAYMENT_MODES.map((pm) => {
            const Icon = pm.icon;
            const isSelected = mode === pm.mode;
            return (
              <button
                key={pm.mode}
                onClick={() => setMode(pm.mode)}
                className={`p-2 rounded-lg border flex items-center gap-2 text-xs font-semibold transition-all ${
                  isSelected ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{pm.label}</span>
              </button>
            );
          })}
        </div>

        {/* Charge Button */}
        <Button
          onClick={charge}
          disabled={cart.length === 0 || charging}
          className="w-full h-11 text-sm font-bold gap-2"
        >
          {charging ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Charge {formatMoney(totals.grandTotal, currency)}
        </Button>
      </div>

      {/* Completed Bill Receipt Modal */}
      {completed && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-sm border-primary/20 shadow-xl space-y-4 p-6 text-center">
            {completed.isOffline ? (
              <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/30 text-xs px-3 py-1 gap-1 mx-auto">
                <WifiOff className="w-3.5 h-3.5" /> Offline Receipt — Queued for Auto-Sync
              </Badge>
            ) : (
              <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs px-3 py-1 gap-1 mx-auto">
                <Check className="w-3.5 h-3.5" /> Transaction Successful
              </Badge>
            )}

            <div>
              <p className="text-xs text-muted-foreground">Invoice Number</p>
              <h3 className="text-xl font-bold font-mono tracking-tight">{completed.invoice.documentNumber}</h3>
            </div>

            <div className="p-3 bg-muted/40 rounded-lg text-sm space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Amount Paid</span>
                <span className="font-bold text-foreground">{formatMoney(completed.invoice.grandTotal, currency)}</span>
              </div>
              {completed.change > 0 && (
                <div className="flex justify-between text-xs text-emerald-600 font-bold">
                  <span>Change Due</span>
                  <span>{formatMoney(completed.change, currency)}</span>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => window.print()} className="flex-1 gap-1 text-xs">
                <Printer className="w-3.5 h-3.5" /> Print Receipt
              </Button>
              <Button size="sm" onClick={() => setCompleted(null)} className="flex-1 text-xs">
                Next Order
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
