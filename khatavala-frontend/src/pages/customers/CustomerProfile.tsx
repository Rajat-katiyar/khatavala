import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Loader2, Pencil, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LedgerTable } from '@/components/LedgerTable';
import { Can } from '@/components/Can';
import { useCompanyStore } from '@/store/companyStore';
import { formatDate, formatMoney } from '@/lib/utils';
import * as customerService from '@/services/customer.service';
import type { Customer, CustomerAddress, CustomerLedger } from '@/types';
import { CustomerDrawer } from './CustomerDrawer';
import { BalanceCell } from './CustomerTableParts';

function AddressBlock({ label, address }: { label: string; address?: CustomerAddress }) {
  const lines = [
    address?.line1,
    address?.line2,
    [address?.city, address?.state].filter(Boolean).join(', '),
    address?.pincode,
  ].filter((line) => line && String(line).trim());

  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Not provided</p>
      ) : (
        <address className="text-sm not-italic text-muted-foreground">
          {lines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </address>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-sm font-medium">{label}</p>
      <p className={`text-sm text-muted-foreground ${mono ? 'font-mono' : ''}`}>
        {value || 'Not provided'}
      </p>
    </div>
  );
}

export function CustomerProfile() {
  const { id } = useParams<{ id: string }>();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [ledger, setLedger] = useState<CustomerLedger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [customerData, ledgerData] = await Promise.all([
        customerService.getCustomer(id),
        customerService.getLedger(id, { limit: 200 }),
      ]);
      setCustomer(customerData);
      setLedger(ledgerData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this customer');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="flex items-center py-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading customer…
      </p>
    );
  }

  if (error || !customer) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-destructive">
          {error ?? 'Customer not found'}
        </p>
        <Button variant="outline" asChild>
          <Link to="/customers">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to customers
          </Link>
        </Button>
      </div>
    );
  }

  const overLimit =
    customer.creditLimit > 0 && customer.currentBalance > customer.creditLimit;
  const available = customer.creditLimit - customer.currentBalance;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/customers"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Customers
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{customer.name}</h1>
            {!customer.isActive && <Badge variant="muted">Inactive</Badge>}
            {overLimit && <Badge variant="destructive">Over credit limit</Badge>}
          </div>
          <p className="font-mono text-sm text-muted-foreground">{customer.phone}</p>
        </div>
        <Can permission="customers.update">
          <Button variant="outline" onClick={() => setDrawerOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Button>
        </Can>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl">
              <BalanceCell amount={customer.currentBalance} currency={currency} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Credit limit
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">
              {customer.creditLimit > 0 ? formatMoney(customer.creditLimit, currency) : '—'}
            </p>
            {customer.creditLimit > 0 && (
              <p
                className={`text-xs ${available < 0 ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {available < 0
                  ? `${formatMoney(Math.abs(available), currency)} over`
                  : `${formatMoney(available, currency)} available`}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Opening balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">
              {formatMoney(customer.openingBalance, currency)}
            </p>
            <p className="text-xs text-muted-foreground">Carried in at setup</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="ledger">
            Ledger
            {ledger && ledger.entries.length > 0 && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                {ledger.pagination.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="purchases">Purchase history</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-4">
                <Field label="Email" value={customer.email} />
                <Field label="GST number" value={customer.gstNumber} mono />
                <Field label="PAN" value={customer.pan} mono />
                <Field label="Customer since" value={formatDate(customer.createdAt)} />
              </div>
              <div className="space-y-4">
                <AddressBlock label="Billing address" address={customer.billingAddress} />
                <AddressBlock label="Shipping address" address={customer.shippingAddress} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger">
          <Card>
            <CardHeader>
              <CardTitle>Statement of account</CardTitle>
              <CardDescription>
                Every movement on this account, oldest first. Entries are append-only —
                corrections are posted as new entries, never edits.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LedgerTable
                entries={ledger?.entries ?? []}
                totals={ledger?.totals ?? { debit: 0, credit: 0 }}
                closingBalance={ledger?.customer.currentBalance ?? 0}
                currency={currency}
                emptyMessage="No ledger entries yet. Invoices and payments will appear here as they are recorded."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchases">
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Purchase history</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Invoices raised for {customer.name} will be listed here once the Sales module
                ships. Their financial effect is already visible on the Ledger tab.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Documents</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Signed agreements, GST certificates and other attachments will live here once
                file storage is wired up.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CustomerDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        customer={customer}
        onSaved={() => void load()}
      />
    </div>
  );
}
