import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, PackageCheck, Plus, Search } from 'lucide-react';
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
import { formatDate, formatMoney } from '@/lib/utils';
import * as purchaseService from '@/services/purchase.service';
import type { PurchaseDocumentKind, PurchaseDocumentPage } from '@/types';

const PAGE_SIZE = 25;

export const PURCHASE_META: Record<
  PurchaseDocumentKind,
  { label: string; plural: string; path: string }
> = {
  orders: { label: 'Purchase order', plural: 'Purchase orders', path: '/purchase/orders' },
  grn: { label: 'Goods receipt', plural: 'Goods receipts', path: '/purchase/grn' },
  invoices: { label: 'Purchase bill', plural: 'Purchase bills', path: '/purchase/invoices' },
  returns: { label: 'Debit note', plural: 'Purchase returns', path: '/purchase/returns' },
};

const STATUS_OPTIONS: Record<PurchaseDocumentKind, string[]> = {
  orders: ['Draft', 'Sent', 'Confirmed', 'PartiallyReceived', 'Received', 'Cancelled', 'Converted'],
  grn: ['Draft', 'Received', 'Cancelled'],
  invoices: ['Draft', 'Unpaid', 'PartiallyPaid', 'Paid', 'Cancelled'],
  returns: [],
};

/** Same colour language as the sales side: action loud, settled quiet, dead muted. */
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive' | 'muted'> =
  {
    Draft: 'muted',
    Sent: 'outline',
    Confirmed: 'default',
    PartiallyReceived: 'outline',
    Received: 'secondary',
    Cancelled: 'destructive',
    Converted: 'secondary',
    Unpaid: 'default',
    PartiallyPaid: 'outline',
    Paid: 'secondary',
    Issued: 'secondary',
  };

const STATUS_LABEL: Record<string, string> = {
  PartiallyReceived: 'Part received',
  PartiallyPaid: 'Partly paid',
};

export function PurchaseStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'outline'} className="text-[10px]">
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/**
 * One list for all four purchase document types — the mirror of SalesList.
 * They differ only in status vocabulary and which "next stage" button applies.
 */
export function PurchaseList({ kind }: { kind: PurchaseDocumentKind }) {
  const navigate = useNavigate();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currency = activeCompany?.currency ?? 'INR';
  const meta = PURCHASE_META[kind];

  const [data, setData] = useState<PurchaseDocumentPage | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setStatus('');
    setPage(1);
    setData(null);
  }, [kind]);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);
    try {
      setData(
        await purchaseService.listDocuments(kind, {
          search: debouncedSearch || undefined,
          status: status || undefined,
          page,
          limit: PAGE_SIZE,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not load ${meta.plural}`);
    } finally {
      setLoading(false);
    }
  }, [activeCompany, kind, debouncedSearch, status, page, meta.plural]);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  /** Receiving a draft GRN is the stock-moving action, so it lives on the row. */
  const receive = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await purchaseService.receiveGrn(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not receive the goods');
    } finally {
      setBusy(null);
    }
  };

  const convert = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      if (kind === 'orders') {
        const grn = await purchaseService.convertOrderToGrn(id);
        navigate(`/purchase/grn/${grn._id}`);
      } else {
        const bill = await purchaseService.convertGrnToInvoice(id);
        navigate(`/purchase/invoices/${bill._id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{meta.plural}</h1>
          {data?.summary && (
            <p className="text-sm text-muted-foreground">
              {data.summary.count} documents · {formatMoney(data.summary.value, currency)} total
            </p>
          )}
        </div>
        {kind !== 'returns' && (
          <Can permission="purchases.create">
            <Button asChild>
              <Link to={`${meta.path}/new`}>
                <Plus className="mr-2 h-4 w-4" /> New {meta.label.toLowerCase()}
              </Link>
            </Button>
          </Can>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">All {meta.plural.toLowerCase()}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {kind !== 'returns' && (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Number or supplier"
                    className="w-48 pl-8"
                  />
                </div>
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                  className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">All statuses</option>
                  {STATUS_OPTIONS[kind].map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {error && (
            <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {loading && !data ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : data && data.documents.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              No {meta.plural.toLowerCase()} yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-44" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.documents.map((document) => (
                  <TableRow key={document._id}>
                    <TableCell className="font-medium">
                      <Link className="hover:underline" to={`${meta.path}/${document._id}`}>
                        {document.documentNumber}
                      </Link>
                      {document.supplierInvoiceNumber && (
                        <div className="text-xs text-muted-foreground">
                          Their ref: {document.supplierInvoiceNumber}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(document.date)}
                    </TableCell>
                    <TableCell>{document.supplierName}</TableCell>
                    <TableCell>
                      <PurchaseStatusBadge status={document.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                      {formatMoney(document.grandTotal, currency)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {kind === 'grn' && document.status === 'Draft' && (
                          <Can permission="purchases.update">
                            <Button
                              size="sm"
                              disabled={busy === document._id}
                              onClick={() => receive(document._id)}
                            >
                              {busy === document._id ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Receive
                            </Button>
                          </Can>
                        )}

                        {kind === 'orders' &&
                          ['Draft', 'Sent', 'Confirmed', 'PartiallyReceived'].includes(
                            document.status
                          ) && (
                            <Can permission="purchases.create">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy === document._id}
                                onClick={() => convert(document._id)}
                              >
                                <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Receive
                              </Button>
                            </Can>
                          )}

                        {kind === 'grn' &&
                          document.status === 'Received' &&
                          !document.purchaseInvoiceId && (
                            <Can permission="purchases.create">
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy === document._id}
                                onClick={() => convert(document._id)}
                              >
                                <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Bill
                              </Button>
                            </Can>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {data && data.pagination.pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {data.pagination.page} of {data.pagination.pages} ·{' '}
                {data.pagination.total} documents
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
                  disabled={page >= data.pagination.pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
