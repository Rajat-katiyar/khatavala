import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  Package,
  Users,
  FileText,
  Calculator,
  ShoppingBag,
  Boxes,
  BarChart3,
  BookOpen,
  Receipt,
  Landmark,
  Truck,
  Cpu,
  FileCode,
  Store,
  Megaphone,
  Sparkles,
  UserCheck,
  ShieldCheck,
  History,
  MapPin,
  Camera,
  Loader2,
  X,
  ArrowRight,
} from 'lucide-react';
import { api } from '@/services/api';
import * as productService from '@/services/product.service';
import * as customerService from '@/services/customer.service';
import { formatMoney } from '@/lib/utils';
import type { Product, Customer } from '@/types';

interface SearchResultItem {
  id: string;
  type: 'page' | 'product' | 'customer' | 'invoice';
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  icon: any;
  url: string;
}

const SYSTEM_PAGES: SearchResultItem[] = [
  { id: 'p-pos', type: 'page', title: 'POS Terminal', subtitle: 'Fast Billing & Quick Checkout', badge: 'Fast POS', badgeColor: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300', icon: Calculator, url: '/pos' },
  { id: 'p-products', type: 'page', title: 'Products Catalog', subtitle: 'Manage items, prices, and stock', badge: 'Catalog', badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300', icon: Package, url: '/products' },
  { id: 'p-invoices', type: 'page', title: 'Sales Invoices', subtitle: 'Create & view billing invoices', badge: 'Sales', badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', icon: FileText, url: '/sales/invoices' },
  { id: 'p-customers', type: 'page', title: 'Customers Ledger', subtitle: 'View customer accounts & dues', badge: 'Parties', badgeColor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300', icon: Users, url: '/customers' },
  { id: 'p-purchases', type: 'page', title: 'Purchase Orders', subtitle: 'Supplier procurement & GRN', badge: 'Purchases', badgeColor: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300', icon: ShoppingBag, url: '/purchase/orders' },
  { id: 'p-ocr', type: 'page', title: 'Scan OCR Bill', subtitle: 'Upload purchase invoice photo to bill', badge: 'AI Scan', badgeColor: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300', icon: Camera, url: '/purchase/scan-bill' },
  { id: 'p-inventory', type: 'page', title: 'Inventory Stock', subtitle: 'Stock balance & adjustments', badge: 'Stock', badgeColor: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300', icon: Boxes, url: '/inventory' },
  { id: 'p-reports', type: 'page', title: 'Reports Hub', subtitle: 'GSTR, P&L, Sales & Stock Reports', badge: 'Analytics', badgeColor: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300', icon: BarChart3, url: '/reports' },
  { id: 'p-accounts', type: 'page', title: 'Accounts & Journal', subtitle: 'Double-entry books & ledgers', badge: 'Accounts', badgeColor: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300', icon: BookOpen, url: '/accounting/journal-entries' },
  { id: 'p-expenses', type: 'page', title: 'Expense Tracker', subtitle: 'Track business expenses & recurring bills', badge: 'Expenses', badgeColor: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300', icon: Receipt, url: '/expenses' },
  { id: 'p-banking', type: 'page', title: 'Banking & Reconciliation', subtitle: 'Bank statements & cash flow', badge: 'Banking', badgeColor: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300', icon: Landmark, url: '/banking/accounts' },
  { id: 'p-suppliers', type: 'page', title: 'Suppliers Ledger', subtitle: 'Vendor accounts & payables', badge: 'Parties', badgeColor: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300', icon: Truck, url: '/suppliers' },
  { id: 'p-store', type: 'page', title: 'Online Storefront', subtitle: 'Public e-commerce storefront settings', badge: 'Sell Online', badgeColor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300', icon: Store, url: '/settings/online-store' },
  { id: 'p-campaigns', type: 'page', title: 'WhatsApp Campaigns', subtitle: 'Promotional broadcasts & bulk messaging', badge: 'Marketing', badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', icon: Megaphone, url: '/marketing/campaigns' },
  { id: 'p-smartads', type: 'page', title: 'Smart Ad Copy Generator', subtitle: 'Generate AI WhatsApp & Meta ad copy', badge: 'AI Tools', badgeColor: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300', icon: Sparkles, url: '/marketing/smart-ads' },
  { id: 'p-ai', type: 'page', title: 'AI Business Intelligence Assistant', subtitle: 'Ask questions about your business metrics', badge: 'AI Chat', badgeColor: 'bg-primary/10 text-primary font-semibold', icon: Sparkles, url: '/ai-assistant' },
  { id: 'p-tally', type: 'page', title: 'Tally ERP Data Sync', subtitle: 'Import/Export Tally XML & CSV data', badge: 'Integrations', badgeColor: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300', icon: FileCode, url: '/settings/tally' },
  { id: 'p-hardware', type: 'page', title: 'Hardware Settings', subtitle: 'Thermal Printer & Weighing Scale config', badge: 'Hardware', badgeColor: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300', icon: Cpu, url: '/settings/hardware' },
  { id: 'p-gps', type: 'page', title: 'Salesman GPS Tracking', subtitle: 'Live location tracking & territory logs', badge: 'Tracking', badgeColor: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300', icon: MapPin, url: '/salesman-tracking' },
  { id: 'p-users', type: 'page', title: 'Company Users & Roles', subtitle: 'Invite users & assign permissions', badge: 'Settings', badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300', icon: UserCheck, url: '/settings/users' },
  { id: 'p-roles', type: 'page', title: 'Roles & Permissions', subtitle: 'Configure custom roles', badge: 'Settings', badgeColor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300', icon: ShieldCheck, url: '/settings/roles' },
  { id: 'p-audit', type: 'page', title: 'Activity Audit Log', subtitle: 'Platform audit history & changes', badge: 'Security', badgeColor: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300', icon: History, url: '/settings/activity-log' },
];

export function GlobalSearchModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Auto-focus search input on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Live Elastic Search Logic across Products, Customers, Invoices, Pages
  const executeSearch = useCallback(async (q: string) => {
    const trimmed = q.trim().toLowerCase();
    if (!trimmed) {
      setResults(SYSTEM_PAGES.slice(0, 8));
      return;
    }

    setLoading(true);
    try {
      // 1. Filter System Pages
      const matchedPages = SYSTEM_PAGES.filter(
        (p) =>
          p.title.toLowerCase().includes(trimmed) ||
          p.subtitle?.toLowerCase().includes(trimmed) ||
          p.badge?.toLowerCase().includes(trimmed)
      );

      // 2. Search Products & Customers & Invoices in Parallel
      const [productsRes, customersRes, invoicesRes] = await Promise.allSettled([
        productService.searchProducts(trimmed, 5),
        customerService.listCustomers({ search: trimmed, limit: 5 }),
        api.get('/sales/invoices', { params: { search: trimmed, limit: 5 } }),
      ]);

      const productItems: SearchResultItem[] =
        productsRes.status === 'fulfilled'
          ? (productsRes.value || []).map((p: Product) => ({
              id: `prod-${p._id}`,
              type: 'product',
              title: p.name,
              subtitle: `SKU: ${p.sku} · Stock: ${p.currentStock} · Price: ${formatMoney(p.sellingPrice)}`,
              badge: 'Product',
              badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
              icon: Package,
              url: `/products/${p._id}/edit`,
            }))
          : [];

      const customerItems: SearchResultItem[] =
        customersRes.status === 'fulfilled'
          ? (customersRes.value.customers || []).map((c: Customer) => ({
              id: `cust-${c._id}`,
              type: 'customer',
              title: c.name,
              subtitle: `Phone: ${c.phone} ${c.currentBalance !== 0 ? `· Due: ${formatMoney(c.currentBalance)}` : ''}`,
              badge: 'Customer',
              badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
              icon: Users,
              url: '/customers',
            }))
          : [];

      const invoiceItems: SearchResultItem[] =
        invoicesRes.status === 'fulfilled'
          ? (invoicesRes.value.data.data?.invoices || []).map((inv: any) => ({
              id: `inv-${inv._id}`,
              type: 'invoice',
              title: `${inv.documentNumber} — ${inv.customerName}`,
              subtitle: `Total: ${formatMoney(inv.grandTotal)} · Status: ${inv.status}`,
              badge: 'Invoice',
              badgeColor: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
              icon: FileText,
              url: `/sales/invoices/${inv._id}`,
            }))
          : [];

      const combined = [
        ...matchedPages,
        ...productItems,
        ...customerItems,
        ...invoiceItems,
      ];

      setResults(combined);
      setSelectedIndex(0);
    } catch {
      // Fallback to page search
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void executeSearch(query);
    }, 150);
    return () => clearTimeout(timer);
  }, [query, executeSearch]);

  // Keyboard navigation (Arrow Up/Down, Enter, Escape)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[selectedIndex];
      if (target) {
        onClose();
        navigate(target.url);
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-card border shadow-2xl rounded-2xl overflow-hidden flex flex-col max-h-[80vh] border-primary/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header Input */}
        <div className="flex items-center px-4 py-3.5 border-b bg-muted/30">
          <Search className="w-5 h-5 text-primary shrink-0 mr-3" />
          <input
            ref={inputRef}
            type="text"
            className="w-full bg-transparent text-base outline-none placeholder:text-muted-foreground font-medium"
            placeholder="Elastic Search — search products, customers, invoices, pages, features... (CTRL+SHIFT+K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0 ml-2" />
          ) : query ? (
            <button onClick={() => setQuery('')} className="p-1 rounded-full hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          ) : (
            <kbd className="hidden sm:inline-block text-[11px] font-mono font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded border">
              ESC to close
            </kbd>
          )}
        </div>

        {/* Results List */}
        <div className="overflow-y-auto p-2 space-y-1 max-h-[60vh]">
          {results.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground space-y-2">
              <Search className="w-8 h-8 mx-auto text-muted-foreground/40" />
              <p className="font-medium text-sm">No matching results found for "{query}"</p>
              <p className="text-xs">Try searching by product SKU, customer phone, invoice number, or page name.</p>
            </div>
          ) : (
            results.map((item, index) => {
              const IconComponent = item.icon;
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    onClose();
                    navigate(item.url);
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : 'hover:bg-muted/60 text-foreground'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div
                      className={`p-2 rounded-lg shrink-0 ${
                        isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-primary'
                      }`}
                    >
                      <IconComponent className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{item.title}</span>
                        {item.badge && (
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                              isSelected ? 'bg-primary-foreground/20 text-primary-foreground' : item.badgeColor
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </div>
                      {item.subtitle && (
                        <p
                          className={`text-xs truncate mt-0.5 ${
                            isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'
                          }`}
                        >
                          {item.subtitle}
                        </p>
                      )}
                    </div>
                  </div>
                  <ArrowRight
                    className={`w-4 h-4 shrink-0 transition-transform ${
                      isSelected ? 'translate-x-1 text-primary-foreground' : 'opacity-0'
                    }`}
                  />
                </div>
              );
            })
          )}
        </div>

        {/* Footer shortcuts helper */}
        <div className="px-4 py-2.5 border-t bg-muted/20 text-[11px] text-muted-foreground flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span><kbd className="font-semibold bg-muted px-1.5 py-0.5 rounded border">↑↓</kbd> Navigate</span>
            <span><kbd className="font-semibold bg-muted px-1.5 py-0.5 rounded border">↵</kbd> Select</span>
          </div>
          <span className="font-medium text-primary">Khatavala Elastic Omnisearch</span>
        </div>
      </div>
    </div>
  );
}
