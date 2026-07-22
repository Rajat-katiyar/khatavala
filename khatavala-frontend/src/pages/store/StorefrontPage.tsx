import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  ShoppingCart,
  Plus,
  Minus,
  X,
  Store,
  Phone,
  MapPin,
  CheckCircle2,
  Loader2,
  Search,
  Package,
} from 'lucide-react';
import { api } from '@/services/api';

interface StoreInfo {
  storeName: string;
  tagline: string;
  logoUrl: string | null;
  themeColor: string;
  whatsappNumber: string | null;
  storeSlug: string;
}

interface StoreProduct {
  _id: string;
  name: string;
  sku: string;
  sellingPrice: number;
  mrp: number;
  imageUrl: string | null;
  onlineStoreDescription: string | null;
  currentStock: number;
  gstPercentage: number;
}

interface CartItem extends StoreProduct {
  quantity: number;
}

export function StorefrontPage() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<'cart' | 'form' | 'success'>('cart');
  const [orderResult, setOrderResult] = useState<any>(null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ customerName: '', customerPhone: '', customerAddress: '', notes: '' });

  useEffect(() => {
    if (!storeSlug) return;
    setLoading(true);
    api.get(`/store/${storeSlug}/products`)
      .then((res) => {
        setStore(res.data.data.store);
        setProducts(res.data.data.products);
      })
      .catch(() => setError('Store not found or is currently offline.'))
      .finally(() => setLoading(false));
  }, [storeSlug]);

  useEffect(() => {
    if (!storeSlug || !search) return;
    const t = setTimeout(() => {
      api.get(`/store/${storeSlug}/products?search=${search}`)
        .then((res) => setProducts(res.data.data.products));
    }, 400);
    return () => clearTimeout(t);
  }, [search, storeSlug]);

  const addToCart = (product: StoreProduct) => {
    setCart((prev) => {
      const existing = prev.find((c) => c._id === product._id);
      if (existing) return prev.map((c) => c._id === product._id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev.map((c) => c._id === id ? { ...c, quantity: Math.max(1, c.quantity + delta) } : c)
    );
  };

  const removeFromCart = (id: string) => setCart((prev) => prev.filter((c) => c._id !== id));

  const cartTotal = cart.reduce((sum, c) => sum + c.sellingPrice * c.quantity, 0);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);

  const handleCheckout = async () => {
    if (!form.customerName || !form.customerPhone) return;
    setPlacing(true);
    try {
      const res = await api.post(`/store/${storeSlug}/checkout`, {
        ...form,
        items: cart.map((c) => ({ productId: c._id, quantity: c.quantity })),
      });
      setOrderResult(res.data.data);
      setCheckoutStep('success');
      setCart([]);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Checkout failed. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  const themeColor = store?.themeColor || '#6366f1';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3">
          <Loader2 className="w-10 h-10 animate-spin mx-auto text-indigo-500" />
          <p className="text-gray-500 text-sm">Loading store...</p>
        </div>
      </div>
    );
  }

  if (error && !store) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center space-y-3 max-w-sm">
          <Store className="w-12 h-12 text-gray-300 mx-auto" />
          <h2 className="text-xl font-bold text-gray-700">Store Not Found</h2>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {/* Header */}
      <header style={{ backgroundColor: themeColor }} className="text-white shadow-md sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {store?.logoUrl ? (
              <img src={store.logoUrl} alt="logo" className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <Store className="w-7 h-7 text-white/80" />
            )}
            <div>
              <h1 className="font-bold text-lg leading-tight">{store?.storeName}</h1>
              {store?.tagline && <p className="text-white/70 text-xs">{store.tagline}</p>}
            </div>
          </div>
          <button
            onClick={() => { setCartOpen(true); setCheckoutStep('cart'); }}
            className="relative flex items-center gap-2 bg-white/15 hover:bg-white/25 transition px-4 py-2 rounded-full text-sm font-semibold"
          >
            <ShoppingCart className="w-4 h-4" />
            Cart
            {cartCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-yellow-400 text-gray-900 text-xs font-bold flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Search */}
      <div className="max-w-5xl mx-auto px-4 mt-5 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      </div>

      {/* Product Grid */}
      <div className="max-w-5xl mx-auto px-4 pb-16">
        {products.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Package className="w-14 h-14 mx-auto mb-3 text-gray-200" />
            <p>No products found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {products.map((product) => {
              const inCart = cart.find((c) => c._id === product._id);
              return (
                <div
                  key={product._id}
                  className="bg-white rounded-2xl shadow-sm hover:shadow-md transition overflow-hidden border border-gray-100"
                >
                  {product.imageUrl ? (
                    <img src={product.imageUrl} alt={product.name} className="w-full h-36 object-cover" />
                  ) : (
                    <div className="w-full h-36 flex items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
                      <Package className="w-10 h-10 text-indigo-200" />
                    </div>
                  )}
                  <div className="p-3">
                    <p className="font-semibold text-sm text-gray-800 leading-snug line-clamp-2">{product.name}</p>
                    {product.onlineStoreDescription && (
                      <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{product.onlineStoreDescription}</p>
                    )}
                    <div className="mt-2 flex items-center justify-between">
                      <div>
                        <p className="font-bold text-gray-900">₹{product.sellingPrice.toFixed(2)}</p>
                        {product.mrp > product.sellingPrice && (
                          <p className="text-xs text-gray-400 line-through">MRP ₹{product.mrp}</p>
                        )}
                      </div>
                    </div>
                    {inCart ? (
                      <div className="mt-2 flex items-center gap-2">
                        <button onClick={() => updateQty(product._id, -1)} className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-gray-100">
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-bold text-sm w-4 text-center">{inCart.quantity}</span>
                        <button onClick={() => updateQty(product._id, 1)} className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-gray-100">
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        style={{ backgroundColor: themeColor }}
                        onClick={() => addToCart(product)}
                        className="mt-2 w-full text-white text-xs py-1.5 rounded-lg font-semibold hover:opacity-90 transition"
                      >
                        Add to Cart
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cart Drawer */}
      {cartOpen && (
        <div className="fixed inset-0 z-30 flex">
          <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <div className="w-full max-w-md bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
            <div className="px-5 py-4 flex items-center justify-between border-b sticky top-0 bg-white z-10">
              <h2 className="font-bold text-lg">
                {checkoutStep === 'cart' ? '🛒 Your Cart' : checkoutStep === 'form' ? '📋 Checkout' : '✅ Order Placed!'}
              </h2>
              <button onClick={() => setCartOpen(false)} className="p-1.5 rounded-full hover:bg-gray-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            {checkoutStep === 'success' && orderResult ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 space-y-4">
                <CheckCircle2 className="w-16 h-16 text-emerald-500" />
                <h3 className="text-xl font-bold text-gray-800">Order Placed Successfully!</h3>
                <p className="text-gray-500 text-sm">{orderResult.message}</p>
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 w-full text-left space-y-1.5">
                  <p className="text-sm"><span className="font-medium">Order #:</span> {orderResult.documentNumber}</p>
                  <p className="text-sm"><span className="font-medium">Total:</span> ₹{orderResult.grandTotal?.toFixed(2)}</p>
                </div>
                <button
                  style={{ backgroundColor: themeColor }}
                  onClick={() => { setCartOpen(false); setCheckoutStep('cart'); }}
                  className="mt-2 px-6 py-2.5 text-white rounded-xl font-semibold hover:opacity-90 transition"
                >
                  Continue Shopping
                </button>
              </div>
            ) : checkoutStep === 'form' ? (
              <div className="flex-1 px-5 py-4 space-y-4">
                <p className="text-sm text-gray-500">Fill in your details to place the order.</p>
                {[
                  { label: 'Your Name *', key: 'customerName', type: 'text', icon: null },
                  { label: 'Phone Number *', key: 'customerPhone', type: 'tel', icon: <Phone className="w-4 h-4 text-gray-400" /> },
                  { label: 'Delivery Address', key: 'customerAddress', type: 'text', icon: <MapPin className="w-4 h-4 text-gray-400" /> },
                  { label: 'Notes (optional)', key: 'notes', type: 'text', icon: null },
                ].map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                    <input
                      type={f.type}
                      value={(form as any)[f.key]}
                      onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    />
                  </div>
                ))}
                {error && <p className="text-red-500 text-xs">{error}</p>}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => setCheckoutStep('cart')} className="flex-1 border rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">
                    Back
                  </button>
                  <button
                    style={{ backgroundColor: themeColor }}
                    onClick={handleCheckout}
                    disabled={placing || !form.customerName || !form.customerPhone}
                    className="flex-1 text-white rounded-xl py-2.5 text-sm font-semibold hover:opacity-90 transition flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {placing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Place Order
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 px-5 py-4 flex flex-col">
                {cart.length === 0 ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3">
                    <ShoppingCart className="w-12 h-12 text-gray-200" />
                    <p className="text-sm">Your cart is empty</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-3 flex-1">
                      {cart.map((item) => (
                        <div key={item._id} className="flex items-center gap-3 border rounded-xl p-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-gray-800 truncate">{item.name}</p>
                            <p className="text-xs text-gray-400">₹{item.sellingPrice} × {item.quantity}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => updateQty(item._id, -1)} className="w-6 h-6 rounded-full border flex items-center justify-center hover:bg-gray-100 text-xs">
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-5 text-center text-sm font-bold">{item.quantity}</span>
                            <button onClick={() => updateQty(item._id, 1)} className="w-6 h-6 rounded-full border flex items-center justify-center hover:bg-gray-100">
                              <Plus className="w-3 h-3" />
                            </button>
                            <button onClick={() => removeFromCart(item._id)} className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-red-50 text-red-400 ml-1">
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-sm font-bold w-14 text-right">₹{(item.sellingPrice * item.quantity).toFixed(2)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="border-t mt-4 pt-4 sticky bottom-0 bg-white">
                      <div className="flex justify-between font-bold text-base mb-4">
                        <span>Total</span>
                        <span>₹{cartTotal.toFixed(2)}</span>
                      </div>
                      <button
                        style={{ backgroundColor: themeColor }}
                        onClick={() => setCheckoutStep('form')}
                        className="w-full text-white py-3 rounded-xl font-bold text-base hover:opacity-90 transition"
                      >
                        Proceed to Checkout
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
