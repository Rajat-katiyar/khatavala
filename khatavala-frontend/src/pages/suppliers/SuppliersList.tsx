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
import { SortableHead } from '@/components/SortableHead';
import { Can } from '@/components/Can';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as supplierService from '@/services/supplier.service';
import type { PayablesSummary, Supplier } from '@/types';
import { PayableCell, RatingStars, type SupplierSortField as SortField } from './SupplierTableParts';
import { SupplierDrawer } from './SupplierDrawer';
import { SupplierImportDrawer } from './SupplierImportDrawer';

const PAGE_SIZE = 25;

export function SuppliersList() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currency = activeCompany?.currency ?? 'INR';

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<PayablesSummary['totals'] | null>(null);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [duesOnly, setDuesOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
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
      const [list, payables] = await Promise.all([
        supplierService.listSuppliers({
          search: debouncedSearch || undefined,
          sortBy,
          sortDir,
          page,
          limit: PAGE_SIZE,
          hasDues: duesOnly || undefined,
        }),
        supplierService.getOutstandingPayables(),
      ]);
      setSuppliers(list.suppliers);
      setPages(list.pagination.pages);
      setTotal(list.pagination.total);
      setSummary(payables.totals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load suppliers');
    } finally {
      setLoading(false);
    }
  }, [activeCompany, debouncedSearch, sortBy, sortDir, page, duesOnly]);

  // tenantVersion is the refetch trigger: switching companies bumps it, which
  // re-runs this effect with the newly scoped access token in place.
  useEffect(() => {
    setSuppliers([]);
    void load();
  }, [load, tenantVersion]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      // Money and rating columns are more useful largest-first; text A–Z.
      setSortDir(field === 'currentBalance' || field === 'vendorRating' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const handleDelete = async (supplier: Supplier) => {
    const confirmed = window.confirm(
      `Remove ${supplier.name}? If they have ledger history they will be deactivated rather than deleted, so their statement is preserved.`
    );
    if (!confirmed) return;
    try {
      await supplierService.deleteSupplier(supplier._id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this supplier');
    }
  };

  const stats = useMemo(
    () => [
      { label: 'Total payable', value: formatMoney(summary?.totalPayable ?? 0, currency) },
      { label: 'Paid in advance', value: formatMoney(summary?.totalAdvancePaid ?? 0, currency) },
      { label: 'Suppliers we owe', value: String(summary?.suppliersWithDues ?? 0) },
    ],
    [summary, currency]
  );

  if (!activeCompany) {
    return (
      <p className="text-sm text-muted-foreground">
        Create or select a company to manage suppliers.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Suppliers</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : `${total} supplier(s) in ${activeCompany.name}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Can permission="suppliers.create">
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
              Add supplier
            </Button>
          </Can>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
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
              aria-label="Search suppliers"
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
            Payable only
          </label>
        </CardHeader>

        <CardContent>
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {loading && suppliers.length === 0 ? (
            <p className="flex items-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading suppliers…
            </p>
          ) : suppliers.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              {debouncedSearch || duesOnly
                ? 'No suppliers match these filters.'
                : 'No suppliers yet. Add one, or import your existing list from Excel.'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHead
                    field="name"
                    activeField={sortBy}
                    direction={sortDir}
                    onSort={toggleSort}
                  >
                    Name
                  </SortableHead>
                  <SortableHead
                    field="phone"
                    activeField={sortBy}
                    direction={sortDir}
                    onSort={toggleSort}
                  >
                    Phone
                  </SortableHead>
                  <TableHead>GST</TableHead>
                  <SortableHead
                    field="vendorRating"
                    activeField={sortBy}
                    direction={sortDir}
                    onSort={toggleSort}
                  >
                    Rating
                  </SortableHead>
                  <SortableHead
                    field="currentBalance"
                    activeField={sortBy}
                    direction={sortDir}
                    onSort={toggleSort}
                    className="text-right"
                  >
                    Outstanding payable
                  </SortableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((supplier) => (
                  <TableRow key={supplier._id}>
                    <TableCell>
                      <Link
                        to={`/suppliers/${supplier._id}`}
                        className="font-medium hover:underline"
                      >
                        {supplier.name}
                      </Link>
                      {!supplier.isActive && (
                        <Badge variant="muted" className="ml-2 text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{supplier.phone}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {supplier.gstNumber || '—'}
                    </TableCell>
                    <TableCell>
                      <RatingStars rating={supplier.vendorRating} />
                    </TableCell>
                    <TableCell className="text-right">
                      <PayableCell amount={supplier.currentBalance} currency={currency} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Can permission="suppliers.update">
                          <button
                            onClick={() => {
                              setEditing(supplier);
                              setDrawerOpen(true);
                            }}
                            aria-label={`Edit ${supplier.name}`}
                            className="p-1 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </Can>
                        <Can permission="suppliers.delete">
                          <button
                            onClick={() => void handleDelete(supplier)}
                            aria-label={`Remove ${supplier.name}`}
                            className="p-1 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </Can>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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

      <SupplierDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        supplier={editing}
        onSaved={() => void load()}
      />
      <SupplierImportDrawer
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => void load()}
      />
    </div>
  );
}
