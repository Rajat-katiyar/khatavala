import { useEffect, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  FileText,
  IndianRupee,
  Package,
  TrendingUp,
  AlertCircle,
  Percent,
  RefreshCw,
  Sparkles,
  Lightbulb,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as dashboardService from '@/services/dashboard.service';
import type { DashboardMetricsPayload } from '@/services/dashboard.service';
import * as aiService from '@/services/aiAssistant.service';
import type { DemandForecastItem } from '@/services/aiAssistant.service';

type DateRangeOption = 'today' | 'week' | 'month' | 'year' | 'custom';

export function Dashboard() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [range, setRange] = useState<DateRangeOption>('month');
  const [data, setData] = useState<DashboardMetricsPayload | null>(null);
  const [forecast, setForecast] = useState<DemandForecastItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = async (r: DateRangeOption) => {
    setLoading(true);
    try {
      const [res, fc] = await Promise.all([
        dashboardService.getDashboardMetrics({ range: r }),
        aiService.getDemandForecast().catch(() => []),
      ]);
      setData(res);
      setForecast(fc);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchDashboard(range);
  }, [range]);

  return (
    <div className="space-y-6">
      {/* Header & Range Selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Main Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Executive financial snapshot, sales trajectory, and inventory alerts.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 border p-1 rounded-lg bg-card shadow-xs text-xs">
            <button
              onClick={() => setRange('today')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                range === 'today' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setRange('week')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                range === 'week' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              This Week
            </button>
            <button
              onClick={() => setRange('month')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                range === 'month' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setRange('year')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                range === 'year' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              This Year
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchDashboard(range)}
            disabled={loading}
            className="h-9 px-3"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Top Metric KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Sales Revenue
            </CardTitle>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {data ? formatMoney(data.kpis.totalSales, currency) : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Total posted invoices</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Purchases
            </CardTitle>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <FileText className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {data ? formatMoney(data.kpis.totalPurchases, currency) : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Vendor procurement cost</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Cash Collection
            </CardTitle>
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <IndianRupee className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {data ? formatMoney(data.kpis.cashCollected, currency) : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Payments received</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Outstanding
            </CardTitle>
            <div className="p-2 rounded-lg bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
              {data ? formatMoney(data.kpis.outstandingReceivables, currency) : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Pending customer dues</p>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
              Net Profit
            </CardTitle>
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <BarChart3 className="w-4 h-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold tracking-tight ${(data?.kpis.netProfit ?? 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {data ? formatMoney(data.kpis.netProfit, currency) : '—'}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Sales − Purchases − Expenses</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Charts Section */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Sales Trend Chart (2 Cols) */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Sales Trend (Daily)
            </CardTitle>
            <CardDescription>Revenue trajectory over selected period</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">
                Loading sales trend…
              </div>
            ) : data && data.salesTrend.length > 0 ? (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.salesTrend}>
                    <defs>
                      <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(val: any) => formatMoney(Number(val || 0), currency)} />
                    <Area
                      type="monotone"
                      dataKey="sales"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#salesGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-xs text-muted-foreground">
                No sales data recorded for the selected range.
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Smart Reorder Suggestions Card Widget */}
        <Card className="border-primary/20 bg-card">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2 text-primary">
              <Sparkles className="w-4 h-4 text-primary" /> AI Smart Reorder Suggestions
            </CardTitle>
            <CardDescription>Sales velocity analysis & stock-out risk forecast</CardDescription>
          </CardHeader>
          <CardContent>
            {forecast.length > 0 ? (
              <div className="space-y-3">
                {forecast.slice(0, 3).map((fc) => (
                  <div key={fc.productId} className="p-3 rounded-lg border bg-muted/30 text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold">
                      <span>{fc.productName}</span>
                      <Badge
                        variant="outline"
                        className={fc.riskLevel === 'High' ? 'bg-rose-500/10 text-rose-600 border-rose-500/20' : 'bg-amber-500/10 text-amber-600'}
                      >
                        {fc.riskLevel} Risk
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">
                      Stock: <span className="font-bold text-foreground">{fc.currentStock}</span> · Burn Rate: <span className="font-bold text-foreground">{fc.dailyBurnRate}/day</span>
                    </p>
                    {fc.suggestedReorderQty > 0 && (
                      <p className="text-primary font-semibold flex items-center gap-1 pt-0.5">
                        <Lightbulb className="w-3.5 h-3.5" /> Reorder Suggestion: +{fc.suggestedReorderQty} units
                      </p>
                    )}
                  </div>
                ))}

                <Button variant="outline" size="sm" asChild className="w-full text-xs gap-1">
                  <Link to="/ai-assistant">Open AI Assistant Portal</Link>
                </Button>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground">
                All inventory levels optimal. No stock-out risks detected.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Lower Section Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Selling Products */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-500" />
              Top 5 Selling Products
            </CardTitle>
            <CardDescription>Ranked by revenue contribution</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">
                Loading products…
              </div>
            ) : data && data.topProducts.length > 0 ? (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.topProducts} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(val: any) => formatMoney(Number(val || 0), currency)} />
                    <Bar dataKey="revenue" fill="#10b981" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">
                No product sales recorded yet.
              </div>
            )}
          </CardContent>
        </Card>

        {/* GST Liability Widget */}
        <Card className={data && data.gstLiability.netPayable > 0 ? 'border-amber-500/40' : 'border-emerald-500/30'}>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Percent className="w-4 h-4 text-primary" />
              GST Tax Liability Snapshot
            </CardTitle>
            <CardDescription>Current period tax liability vs Input Tax Credit (ITC)</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading GST snapshot…</div>
            ) : data ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3 text-center p-3 rounded-lg bg-muted/40">
                  <div>
                    <p className="text-xs text-muted-foreground">Outward Tax</p>
                    <p className="text-base font-semibold tabular-nums mt-0.5">
                      {formatMoney(data.gstLiability.outwardTax, currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">ITC Available</p>
                    <p className="text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                      − {formatMoney(data.gstLiability.itcAvailable, currency)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold">Net Payable</p>
                    <p className={`text-base font-bold tabular-nums mt-0.5 ${data.gstLiability.netPayable > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {formatMoney(data.gstLiability.netPayable, currency)}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <div className="flex items-center gap-1.5">
                    {data.gstLiability.netPayable > 0 ? (
                      <>
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                        <span className="text-muted-foreground">Net GST liability due</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span className="text-muted-foreground">ITC covers total tax liability</span>
                      </>
                    )}
                  </div>

                  <Button variant="ghost" size="sm" asChild className="text-xs">
                    <Link to="/gst/gstr3b">View GSTR-3B</Link>
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
