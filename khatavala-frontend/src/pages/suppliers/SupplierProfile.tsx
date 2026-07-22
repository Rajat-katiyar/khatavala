import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, BellRing, Loader2, Package, Pencil } from 'lucide-react';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LedgerTable } from '@/components/LedgerTable';
import { Can } from '@/components/Can';
import { useCompanyStore } from '@/store/companyStore';
import { formatDate, formatMoney } from '@/lib/utils';
import * as supplierService from '@/services/supplier.service';
import type { CustomerAddress, PaymentReminders, Supplier, SupplierLedger } from '@/types';
import { SupplierDrawer } from './SupplierDrawer';
import { PayableCell, RatingStars } from './SupplierTableParts';

function AddressBlock({ address }: { address?: CustomerAddress }) {
  const lines = [
    address?.line1,
    address?.line2,
    [address?.city, address?.state].filter(Boolean).join(', '),
    address?.pincode,
  ].filter((line) => line && String(line).trim());

  return (
    <div>
      <p className="text-sm font-medium">Address</p>
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

export function SupplierProfile() {
  const { id } = useParams<{ id: string }>();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [ledger, setLedger] = useState<SupplierLedger | null>(null);
  const [reminders, setReminders] = useState<PaymentReminders | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [supplierData, ledgerData, reminderData] = await Promise.all([
        supplierService.getSupplier(id),
        supplierService.getLedger(id, { limit: 200 }),
        supplierService.getPaymentReminders(id),
      ]);
      setSupplier(supplierData);
      setLedger(ledgerData);
      setReminders(reminderData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this supplier');
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
        Loading supplier…
      </p>
    );
  }

  if (error || !supplier) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-destructive">
          {error ?? 'Supplier not found'}
        </p>
        <Button variant="outline" asChild>
          <Link to="/suppliers">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to suppliers
          </Link>
        </Button>
      </div>
    );
  }

  const overdueCount = reminders?.totals.overdue ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/suppliers"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Suppliers
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{supplier.name}</h1>
            {!supplier.isActive && <Badge variant="muted">Inactive</Badge>}
            {overdueCount > 0 && (
              <Badge variant="destructive">
                {overdueCount} overdue bill{overdueCount > 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          <p className="font-mono text-sm text-muted-foreground">{supplier.phone}</p>
        </div>
        <Can permission="suppliers.update">
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
              Outstanding payable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xl">
              <PayableCell amount={supplier.currentBalance} currency={currency} />
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Vendor rating
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-7 items-center">
              <RatingStars rating={supplier.vendorRating} />
            </div>
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
              {formatMoney(supplier.openingBalance, currency)}
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
          <TabsTrigger value="reminders">
            Payment reminders
            {overdueCount > 0 && (
              <span className="ml-1.5 rounded-full bg-destructive px-1.5 text-[10px] text-destructive-foreground">
                {overdueCount}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-4">
                <Field label="Email" value={supplier.email} />
                <Field label="GST number" value={supplier.gstNumber} mono />
                <Field label="PAN" value={supplier.pan} mono />
                <Field label="Supplier since" value={formatDate(supplier.createdAt)} />
              </div>
              <div className="space-y-4">
                <AddressBlock address={supplier.address} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ledger">
          <Card>
            <CardHeader>
              <CardTitle>Statement of account</CardTitle>
              <CardDescription>
                Oldest first. A purchase bill credits this account and increases what you owe;
                a payment you make debits it. Entries are append-only — corrections are posted
                as new entries, never edits.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LedgerTable
                entries={ledger?.entries ?? []}
                totals={ledger?.totals ?? { debit: 0, credit: 0 }}
                closingBalance={ledger?.supplier.currentBalance ?? 0}
                currency={currency}
                debitLabel="Debit (paid)"
                creditLabel="Credit (billed)"
                emptyMessage="No ledger entries yet. Purchase bills and payments will appear here as they are recorded."
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchases">
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <Package className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">Purchase history</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Purchase orders and bills raised against {supplier.name} will be listed here
                once the Purchases module ships. Their financial effect is already visible on
                the Ledger tab.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reminders">
          <Card>
            <CardHeader>
              <CardTitle>Payment reminders</CardTitle>
              <CardDescription>
                Bills with a due date, soonest first. Read from the ledger rather than from the
                net balance — a supplier can be square overall and still have one bill weeks
                overdue.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!reminders || reminders.bills.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <BellRing className="h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">Nothing scheduled</p>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    No bills for {supplier.name} carry a due date yet. The Purchases module
                    sets one on each bill it records, and anything due or overdue will surface
                    here.
                  </p>
                </div>
              ) : (
                <>
                  {reminders.totals.overdue > 0 && (
                    <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      <span>
                        <strong>{reminders.totals.overdue}</strong> overdue bill(s) totalling{' '}
                        <strong>{formatMoney(reminders.totals.overdueAmount, currency)}</strong>
                      </span>
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">Due</TableHead>
                        <TableHead>Bill</TableHead>
                        <TableHead className="w-32">Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reminders.bills.map((bill) => (
                        <TableRow key={bill._id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {bill.dueDate ? formatDate(bill.dueDate) : '—'}
                          </TableCell>
                          <TableCell>{bill.narration || '—'}</TableCell>
                          <TableCell>
                            {bill.status === 'overdue' ? (
                              <Badge variant="destructive" className="text-[10px]">
                                {bill.daysOverdue}d overdue
                              </Badge>
                            ) : bill.status === 'dueSoon' ? (
                              <Badge className="text-[10px]">Due soon</Badge>
                            ) : (
                              <Badge variant="muted" className="text-[10px]">
                                Upcoming
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatMoney(bill.credit, currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <SupplierDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        supplier={supplier}
        onSaved={() => void load()}
      />
    </div>
  );
}
