import { Link } from 'react-router-dom';
import {
  TrendingUp,
  ShoppingBag,
  Boxes,
  Users,
  Percent,
  BookOpen,
  ArrowRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const CATEGORIES = [
  {
    title: 'Sales & Revenue',
    icon: TrendingUp,
    color: 'text-emerald-500 bg-emerald-500/10',
    reports: [
      { name: 'Sales Summary Report', path: '/reports/sales', desc: 'Aggregated revenue, invoice totals & tax breakdown.' },
      { name: 'Product Performance', path: '/reports/product-performance', desc: 'Top sellers & slow-moving products by volume & revenue.' },
    ],
  },
  {
    title: 'Purchases & Procurement',
    icon: ShoppingBag,
    color: 'text-blue-500 bg-blue-500/10',
    reports: [
      { name: 'Purchase Summary Report', path: '/reports/purchases', desc: 'Total bills, cost of goods purchased & supplier breakdown.' },
      { name: 'Expense Register', path: '/expenses', desc: 'Category-wise operational expenses and payment modes.' },
    ],
  },
  {
    title: 'Inventory & Stock Valuation',
    icon: Boxes,
    color: 'text-amber-500 bg-amber-500/10',
    reports: [
      { name: 'Inventory Valuation Report', path: '/reports/inventory-valuation', desc: 'Stock cost valuation vs retail market value per SKU.' },
      { name: 'Stock Movement Ledger', path: '/reports/stock-movement', desc: 'Complete stock audit trail (In, Out, Adjustments).' },
    ],
  },
  {
    title: 'Parties & Outstanding Aging',
    icon: Users,
    color: 'text-indigo-500 bg-indigo-500/10',
    reports: [
      { name: 'Customer Outstanding Aging', path: '/reports/aging?type=customer', desc: 'Receivables breakdown into 0-30, 31-60, 61-90, 90+ day buckets.' },
      { name: 'Supplier Outstanding Aging', path: '/reports/aging?type=supplier', desc: 'Payables breakdown into overdue aging buckets.' },
    ],
  },
  {
    title: 'Financial Statements',
    icon: BookOpen,
    color: 'text-purple-500 bg-purple-500/10',
    reports: [
      { name: 'Trial Balance', path: '/reports/trial-balance', desc: 'Debit vs Credit ledger balance reconciliation.' },
      { name: 'Profit & Loss Statement', path: '/reports/profit-loss', desc: 'Net income, gross profit & operating expenses.' },
      { name: 'Balance Sheet', path: '/reports/balance-sheet', desc: 'Company Assets = Liabilities + Retained Earnings.' },
      { name: 'Day Book', path: '/reports/day-book', desc: 'Daily chronological journal transaction log.' },
    ],
  },
  {
    title: 'GST Compliance & Tax',
    icon: Percent,
    color: 'text-rose-500 bg-rose-500/10',
    reports: [
      { name: 'GSTR-1 Summary', path: '/gst/gstr1', desc: 'Outward B2B and B2C sales summary for GST filing.' },
      { name: 'GSTR-3B Summary', path: '/gst/gstr3b', desc: 'Monthly ITC & liability summary.' },
      { name: 'HSN Summary Report', path: '/gst/hsn-summary', desc: 'HSN/SAC wise tax breakdown.' },
    ],
  },
];

export function ReportsHub() {
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Reports & Business Intelligence</h1>
        <p className="text-sm text-muted-foreground">
          Comprehensive operational, financial, inventory, and GST compliance reports.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <Card key={cat.title} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2.5">
                  <div className={`p-2 rounded-lg ${cat.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <span>{cat.title}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {cat.reports.map((rep) => (
                  <Link
                    key={rep.name}
                    to={rep.path}
                    className="group block p-2.5 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center justify-between font-semibold text-sm group-hover:text-primary transition-colors">
                      <span>{rep.name}</span>
                      <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{rep.desc}</p>
                  </Link>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
