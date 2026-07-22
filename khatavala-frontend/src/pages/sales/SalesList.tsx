import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, Loader2, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import * as salesService from '@/services/sales.service';
import type { SalesDocumentKind, SalesDocumentPage, SalesDocumentStatus } from '@/types';
import { KIND_META, StatusBadge, moneyCell } from './SalesParts';

const PAGE_SIZE = 25;

/** Status options per document type, for the filter. */
const STATUS_OPTIONS: Record<SalesDocumentKind, string[]> = {
  quotations: ['Draft', 'Sent', 'Accepted', 'Rejected', 'Expired', 'Converted'],
  orders: ['Draft', 'Confirmed', 'PartiallyDelivered', 'Delivered', 'Cancelled', 'Converted'],
  invoices: ['Draft', 'Unpaid', 'PartiallyPaid', 'Paid', 'Cancelled'],
};

/**
 * One list component for all three document types.
 *
 * They differ only in their status vocabulary and which "convert to next stage"
 * button they show, so three near-identical files would be three places to fix
 * every future change. Mirrors the shared service and router on the backend.
 */
export function SalesList({ kind }: { kind: SalesDocumentKind }) {
  const navigate = useNavigate();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currency = activeCompany?.currency ?? 'INR';
  const meta = KIND_META[kind];

  const [page_, setPage] = useState(1);
  const [data, setData] = useState<SalesDocumentPage | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [converting, setConverting] = useState<string | null>(null);

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
      setData(
        await salesService.listDocuments(kind, {
          search: debouncedSearch || undefined,
          status: (status || undefined) as SalesDocumentStatus | undefined,
          from: from || undefined,
          // A date input is midnight; without this an end date of "today"
          // would exclude everything raised today.
          to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
          page: page_,
          limit: PAGE_SIZE,
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not load ${meta.plural}`);
    } finally {
      setLoading(false);
    }
  }, [activeCompany, kind, debouncedSearch, status, from, to, page_, meta.plural]);

  // Resets when the document type changes — otherwise switching tabs would
  // carry a status filter that does not exist in the new vocabulary.
  useEffect(() => {
    setStatus('');
    setPage(1);
    setData(null);
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  const convert = async (id: string) => {
    setConverting(id);
    setError(null);
    try {
      const created =
        kind === 'quotations'
          ? await salesService.convertQuotationToOrder(id)
          : await salesService.convertOrderToInvoice(id);
      navigate(
        kind === 'quotations' ? `/sales/orders/${created._id}` : `/sales/invoices/${created._id}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Conversion failed');
      setConverting(null);
    }
  };

  const convertLabel = kind === 'quotations' ? 'To order' : 'To invoice';
  // Only a live document converts. One already converted, rejected or cancelled
  // has no next stage, and the backend refuses it anyway.
  const canConvert = (documentStatus: string) =>
    kind === 'quotations'
      ? ['Draft', 'Sent', 'Accepted'].includes(documentStatus)
      : kind === 'orders'
        ? ['Draft', 'Confirmed', 'PartiallyDelivered', 'Delivered'].includes(documentStatus)
        : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{meta.plural}</h1>
          {data && (
            <p className="text-sm text-muted-foreground">
              {data.summary.count} documents · {formatMoney(data.summary.value, currency)} total
            </p>
          )}
        </div>
        {kind === 'invoices' && (
          <Can permission="sales.create">
            <Button asChild>
              <Link to="/sales/invoices/new">
                <Plus className="mr-2 h-4 w-4" /> New invoice
              </Link>
            </Button>
          </Can>
        )}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">All {meta.plural.toLowerCase()}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Number or customer"
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
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className="w-36"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className="w-36"
            />
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
              No {meta.plural.toLowerCase()} match these filters.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.documents.map((document) => (
                  <TableRow key={document._id}>
                    <TableCell className="font-medium">
                      <Link className="hover:underline" to={`${meta.path}/${document._id}`}>
                        {document.documentNumber}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(document.date)}
                    </TableCell>
                    <TableCell>{document.customerName}</TableCell>
                    <TableCell>
                      <StatusBadge status={document.status} />
                    </TableCell>
                    <TableCell className={moneyCell('font-medium')}>
                      {formatMoney(document.grandTotal, currency)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {kind !== 'invoices' && canConvert(document.status) && (
                          <Can permission="sales.create">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={converting === document._id}
                              onClick={() => convert(document._id)}
                            >
                              {converting === document._id ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              {convertLabel}
                            </Button>
                          </Can>
                        )}
                        <Button asChild variant="ghost" size="icon" title="Open">
                          <Link to={`${meta.path}/${document._id}`}>
                            <FileText className="h-4 w-4" />
                          </Link>
                        </Button>
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
                  disabled={page_ <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page_ >= data.pagination.pages || loading}
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
