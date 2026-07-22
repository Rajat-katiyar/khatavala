import { useEffect, useState } from 'react';
import { Check, Zap, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatMoney } from '@/lib/utils';
import { useCompanyStore } from '@/store/companyStore';
import * as subService from '@/services/subscription.service';
import type { Plan, SubscriptionDetails } from '@/services/subscription.service';

export function BillingPage() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [details, setDetails] = useState<SubscriptionDetails | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    Promise.all([subService.getSubscriptionDetails(), subService.getPlans()])
      .then(([det, pls]) => {
        setDetails(det);
        setPlans(pls);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleUpgrade = async (planId: string) => {
    setUpgrading(planId);
    setMessage(null);
    try {
      const order = await subService.createRazorpayOrder(planId);

      // Check if Razorpay script exists, or execute test-mode fallback verification
      if (typeof window !== 'undefined' && (window as any).Razorpay) {
        const options = {
          key: order.key,
          amount: order.amount,
          currency: order.currency,
          name: 'Khatavala ERP',
          description: `Subscription Upgrade to ${order.planName}`,
          order_id: order.orderId,
          handler: async (response: any) => {
            await subService.verifyPayment({
              planId,
              razorpayOrderId: response.razorpay_order_id,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });
            setMessage(`Successfully upgraded to ${order.planName} plan!`);
            loadData();
          },
          theme: { color: '#2563eb' },
        };
        const rzp = new (window as any).Razorpay(options);
        rzp.open();
      } else {
        // Test mode fallback when Razorpay script is not loaded
        await subService.verifyPayment({ planId, razorpayOrderId: order.orderId });
        setMessage(`Successfully upgraded to ${order.planName} plan (Test Mode)!`);
        loadData();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Upgrade failed');
    } finally {
      setUpgrading(null);
    }
  };

  if (loading || !details) {
    return <div className="py-12 text-center text-sm text-muted-foreground">Loading subscription details…</div>;
  }

  const { plan, usage, subscription } = details;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Subscription & Billing</h1>
        <p className="text-sm text-muted-foreground">
          Manage your subscription tier, track monthly resource usage, and upgrade plan limits.
        </p>
      </div>

      {message && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{message}</span>
        </div>
      )}

      {/* Current Plan Overview Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Badge className="text-xs px-2.5 py-0.5 font-bold uppercase" variant="default">
                {plan.name} Plan
              </Badge>
              <Badge variant="outline" className="capitalize text-xs">
                Status: {subscription.status}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Valid until: <span className="font-semibold text-foreground">{formatDate(subscription.endDate)}</span>
            </p>
          </div>
        </CardHeader>

        {/* Usage Progress Bars */}
        <CardContent className="space-y-4 pt-0">
          <div className="grid gap-4 sm:grid-cols-3 pt-2">
            {/* Invoices Usage */}
            <div className="space-y-1.5 bg-card p-3 rounded-lg border">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-muted-foreground">Invoices This Month</span>
                <span className="font-bold">{usage.invoicesThisMonth} / {usage.maxInvoices}</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${Math.min(100, (usage.invoicesThisMonth / usage.maxInvoices) * 100)}%` }}
                />
              </div>
            </div>

            {/* Users Usage */}
            <div className="space-y-1.5 bg-card p-3 rounded-lg border">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-muted-foreground">Team Users</span>
                <span className="font-bold">{usage.usersCount} / {usage.maxUsers}</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, (usage.usersCount / usage.maxUsers) * 100)}%` }}
                />
              </div>
            </div>

            {/* Warehouses Usage */}
            <div className="space-y-1.5 bg-card p-3 rounded-lg border">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-muted-foreground">Warehouses</span>
                <span className="font-bold">{usage.warehousesCount} / {usage.maxWarehouses}</span>
              </div>
              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${Math.min(100, (usage.warehousesCount / usage.maxWarehouses) * 100)}%` }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Plan Selection Grid */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Available Subscription Plans</h2>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {plans.map((p) => {
            const isCurrent = p.name === plan.name;
            return (
              <Card
                key={p._id}
                className={`relative flex flex-col justify-between transition-all ${
                  isCurrent ? 'border-primary shadow-md ring-1 ring-primary/20' : 'hover:border-primary/50'
                }`}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    Current Plan
                  </div>
                )}

                <CardHeader>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <div className="pt-2">
                    <span className="text-2xl font-bold">{formatMoney(p.price, currency)}</span>
                    <span className="text-xs text-muted-foreground"> / month</span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 flex-1 text-xs">
                  <div className="space-y-2 border-t pt-3">
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{p.maxInvoicesPerMonth >= 999999 ? 'Unlimited' : p.maxInvoicesPerMonth} Invoices / mo</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{p.maxUsers >= 999 ? 'Unlimited' : p.maxUsers} Users</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span>{p.maxWarehouses} Warehouse(s)</span>
                    </div>
                    {p.featureFlags.customTemplates && (
                      <div className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Custom Print Templates</span>
                      </div>
                    )}
                    {p.featureFlags.apiAccess && (
                      <div className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>REST API Integration Access</span>
                      </div>
                    )}
                  </div>
                </CardContent>

                <div className="p-4 pt-0">
                  <Button
                    variant={isCurrent ? 'outline' : 'default'}
                    disabled={isCurrent || upgrading === p._id}
                    onClick={() => handleUpgrade(p._id)}
                    className="w-full text-xs gap-1.5"
                  >
                    {isCurrent ? (
                      'Active Plan'
                    ) : (
                      <>
                        <Zap className="w-3.5 h-3.5" />
                        Upgrade to {p.name}
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
