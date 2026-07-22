import { useEffect, useState } from 'react';
import { Building2, CreditCard, RefreshCw, Calendar, CheckCircle2, Power } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatMoney } from '@/lib/utils';
import * as adminService from '@/services/admin.service';
import type { PlatformMetrics, TenantCompanyItem } from '@/services/admin.service';

export function AdminDashboard() {
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [companies, setCompanies] = useState<TenantCompanyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [met, comp] = await Promise.all([
        adminService.getPlatformMetrics(),
        adminService.listAllCompanies(),
      ]);
      setMetrics(met);
      setCompanies(comp);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleExtend = async (companyId: string) => {
    setBusyId(companyId);
    setMessage(null);
    try {
      await adminService.extendSubscription(companyId, 30);
      setMessage('Subscription extended by 30 days!');
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Extension failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleStatus = async (companyId: string) => {
    setBusyId(companyId);
    setMessage(null);
    try {
      const res = await adminService.toggleCompanyStatus(companyId);
      setMessage(`Company ${res.name} ${res.isActive ? 'activated' : 'suspended'}.`);
      await loadData();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Status update failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">SaaS SuperAdmin Control Panel</h1>
          <p className="text-sm text-muted-foreground">
            Platform-wide tenant administration, MRR metrics, subscription extensions, and account status controls.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Metrics
        </Button>
      </div>

      {message && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{message}</span>
        </div>
      )}

      {/* KPI Metric Cards */}
      {metrics && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-primary" /> Total Tenants
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{metrics.totalTenants}</CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1.5">
                <CreditCard className="w-4 h-4 text-emerald-500" /> Active Subscriptions
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {metrics.activeSubscriptions}
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-primary flex items-center gap-1.5">
                Monthly Recurring Revenue
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold text-primary">
              {formatMoney(metrics.monthlyRecurringRevenue, 'INR')}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-semibold uppercase text-muted-foreground">
                Invoices Processed (This Mo)
              </CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{metrics.invoicesThisMonth}</CardContent>
          </Card>
        </div>
      )}

      {/* Tenant Companies Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Tenant Companies Management</CardTitle>
          <CardDescription>Overview of registered companies, owners, subscription states, and platform usage.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Expiry Date</TableHead>
                <TableHead>Usage (Users / Invoices)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading tenant list…
                  </TableCell>
                </TableRow>
              ) : companies.length > 0 ? (
                companies.map((comp) => (
                  <TableRow key={comp.id}>
                    <TableCell>
                      <span className="font-semibold">{comp.name}</span>
                      <p className="text-xs text-muted-foreground">GSTIN: {comp.gstNumber}</p>
                    </TableCell>

                    <TableCell>
                      <span className="font-medium text-xs">{comp.owner.name}</span>
                      <p className="text-[11px] text-muted-foreground">{comp.owner.email}</p>
                    </TableCell>

                    <TableCell>
                      <Badge variant="outline" className="font-bold text-xs">
                        {comp.subscription.planName}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-xs">
                      {formatDate(comp.subscription.endDate)}
                    </TableCell>

                    <TableCell className="text-xs">
                      <span className="font-medium">{comp.usage.users} users</span> · {comp.usage.invoices} invoices
                    </TableCell>

                    <TableCell>
                      <Badge
                        className={
                          comp.isActive
                            ? 'bg-emerald-500/10 text-emerald-600 font-semibold'
                            : 'bg-rose-500/10 text-rose-600 font-semibold'
                        }
                      >
                        {comp.isActive ? 'Active' : 'Suspended'}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === comp.id}
                        onClick={() => handleExtend(comp.id)}
                        className="h-8 text-xs gap-1"
                      >
                        <Calendar className="w-3.5 h-3.5" /> +30 Days
                      </Button>

                      <Button
                        variant={comp.isActive ? 'destructive' : 'default'}
                        size="sm"
                        disabled={busyId === comp.id}
                        onClick={() => handleToggleStatus(comp.id)}
                        className="h-8 text-xs gap-1"
                      >
                        <Power className="w-3.5 h-3.5" /> {comp.isActive ? 'Suspend' : 'Activate'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No tenant companies registered yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
