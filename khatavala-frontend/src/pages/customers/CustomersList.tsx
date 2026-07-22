import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Can } from '@/components/Can';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as customerService from '@/services/customer.service';
import type { Customer, OutstandingSummary } from '@/types';
import {
  BalanceCell,
  SortableHead,
  type CustomerSortField as SortField,
} from './CustomerTableParts';
import { CustomerDrawer } from './CustomerDrawer';
import { CustomerImportDrawer } from './CustomerImportDrawer';

const PAGE_SIZE = 25;

export function CustomersList() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currency = activeCompany?.currency ?? 'INR';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<OutstandingSummary['totals'] | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [duesOnly, setDuesOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Debounced so typing a name is one request, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);
    try {
      const [list, outstanding] = await Promise.all([
        customerService.listCustomers({
          search: debouncedSearch || undefined,
          sortBy,
          sortDir,
          page,
          limit: PAGE_SIZE,
          hasDues: duesOnly || undefined,
        }),
        customerService.getOutstanding(),
      ]);
      setCustomers(list.customers);
      setPages(list.pagination.pages);
      setTotal(list.pagination.total);
      setSummary(outstanding.totals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load customers');
    } finally {
      setLoading(false);
    }
  }, [activeCompany, debouncedSearch, sortBy, sortDir, page, duesOnly]);

  // tenantVersion is the refetch trigger: switching companies bumps it, which
  // re-runs this effect with the newly scoped access token in place.
  useEffect(() => {
    setCustomers([]);
    void load();
  }, [load, tenantVersion]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      // Money columns are far more useful largest-first; text columns A–Z.
      setSortDir(field === 'currentBalance' || field === 'creditLimit' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const handleDelete = async (customer: Customer) => {
    const confirmed = window.confirm(
      `Remove ${customer.name}? If they have ledger history they will be deactivated rather than deleted, so their statement is preserved.`
    );
    if (!confirmed) return;
    try {
      await customerService.deleteCustomer(customer._id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this customer');
    }
  };

  const stats = useMemo(
    () => [
      { label: 'Total receivable', value: formatMoney(summary?.totalReceivable ?? 0, currency) },
      { label: 'Advances held', value: formatMoney(summary?.totalAdvance ?? 0, currency) },
      { label: 'Customers with dues', value: String(summary?.customersWithDues ?? 0) },
      { label: 'Over credit limit', value: String(summary?.customersOverCreditLimit ?? 0) },
    ],
    [summary, currency]
  );

  if (!activeCompany) {
    return (
      <p className="text-sm text-muted-foreground">
        Create or select a company to manage customers.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : `${total} customer(s) in ${activeCompany.name}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Can permission="customers.create">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setDrawerOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add customer
            </Button>
          </Can>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xl font-semibold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search name, phone or GST…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search customers"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-input"
              checked={duesOnly}
              onChange={(e) => {
                setDuesOnly(e.target.checked);
                setPage(1);
              }}
            />
            Outstanding only
          </label>
        </CardHeader>

        <CardContent>
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {loading && customers.length === 0 ? (
            <p className="flex items-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading customers…
            </p>
          ) : customers.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              {debouncedSearch || duesOnly
                ? 'No customers match these filters.'
                : 'No customers yet. Add one, or import your existing list from Excel.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead field="name" activeField={sortBy} direction={sortDir} onSort={toggleSort}>Name</SortableHead>
                  <SortableHead field="phone" activeField={sortBy} direction={sortDir} onSort={toggleSort}>Phone</SortableHead>
                  <TableHead>GST</TableHead>
                  <SortableHead field="currentBalance" activeField={sortBy} direction={sortDir} onSort={toggleSort} className="text-right">
                    Outstanding
                  </SortableHead>
                  <SortableHead field="creditLimit" activeField={sortBy} direction={sortDir} onSort={toggleSort} className="text-right">
                    Credit limit
                  </SortableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => {
                  const overLimit =
                    customer.creditLimit > 0 && customer.currentBalance > customer.creditLimit;
                  return (
                    <TableRow key={customer._id}>
                      <TableCell>
                        <Link
                          to={`/customers/${customer._id}`}
                          className="font-medium hover:underline"
                        >
                          {customer.name}
                        </Link>
                        <div className="flex gap-1.5 pt-0.5">
                          {!customer.isActive && (
                            <Badge variant="muted" className="text-[10px]">
                              Inactive
                            </Badge>
                          )}
                          {overLimit && (
                            <Badge variant="destructive" className="text-[10px]">
                              Over limit
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{customer.phone}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {customer.gstNumber || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <BalanceCell amount={customer.currentBalance} currency={currency} />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {customer.creditLimit > 0
                          ? formatMoney(customer.creditLimit, currency)
                          : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Can permission="customers.update">
                            <button
                              onClick={() => {
                                setEditing(customer);
                                setDrawerOpen(true);
                              }}
                              aria-label={`Edit ${customer.name}`}
                              className="p-1 text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </Can>
                          <Can permission="customers.delete">
                            <button
                              onClick={() => void handleDelete(customer)}
                              aria-label={`Remove ${customer.name}`}
                              className="p-1 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </Can>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-between pt-4 text-sm">
              <span className="text-muted-foreground">
                Page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <CustomerDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        customer={editing}
        onSaved={() => void load()}
      />
      <CustomerImportDrawer
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void load()}
      />
    </div>
  );
}
