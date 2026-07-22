import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompanyStore } from '@/store/companyStore';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import * as accountingService from '@/services/accounting.service';
import type { AccountLedger } from '@/types';

/**
 * One component for the account ledger, the cash book and the bank book.
 *
 * All three are the same report over a different set of accounts, which is how
 * the backend builds them too — so a second implementation here would be two
 * places to fix the same rendering bug.
 *
 * The OPENING BALANCE row is not decoration. A date-filtered ledger whose first
 * row starts at zero silently claims the account was empty on that date; the
 * carried-forward figure is what makes the running balance column mean anything.
 */

type Mode = 'account' | 'cash' | 'bank';

const PAGE_SIZE = 100;

export function LedgerView({ mode }: { mode: Mode }) {
  const { accountId = '' } = useParams();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currency = activeCompany?.currency ?? 'INR';

  const [ledger, setLedger] = useState<AccountLedger | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        from: from || undefined,
        // A date input is midnight; without this an end date of "today" would
        // exclude everything posted today.
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
        page,
        limit: PAGE_SIZE,
      };
      const fetched =
        mode === 'cash'
          ? await accountingService.getCashBook(params)
          : mode === 'bank'
            ? await accountingService.getBankBook(params)
            : await accountingService.getAccountLedger(accountId, params);
      setLedger(fetched);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the ledger');
    } finally {
      setLoading(false);
    }
  }, [mode, accountId, from, to, page]);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  const title =
    mode === 'cash'
      ? 'Cash book'
      : mode === 'bank'
        ? 'Bank book'
        : (ledger?.account?.accountName ?? 'Ledger');

  const normalBalance = ledger?.account?.normalBalance ?? 'debit';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {mode === 'account' && (
            <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
              <Link to="/accounting/chart-of-accounts">
                <ArrowLeft className="mr-2 h-4 w-4" /> Chart of accounts
              </Link>
            </Button>
          )}
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{title}</h1>
            {ledger?.account && (
              <Badge variant="outline" className="text-[10px]">
                {ledger.account.accountType}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {mode === 'account'
              ? `A ${normalBalance} balance is normal for this account.`
              : mode === 'cash'
                ? 'Every movement through cash accounts.'
                : 'Every movement through bank accounts.'}
          </p>
        </div>

        <div className="flex gap-2">
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
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {ledger && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Figure label="Opening" value={formatMoney(ledger.opening, currency)} />
          <Figure label="Debits" value={formatMoney(ledger.totals.debit, currency)} />
          <Figure label="Credits" value={formatMoney(ledger.totals.credit, currency)} />
          <Figure
            label="Closing"
            value={formatMoney(ledger.closing, currency)}
            emphasis
          />
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && !ledger ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : ledger && ledger.entries.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              Nothing posted in this period.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead className="w-32">Entry</TableHead>
                  <TableHead>Particulars</TableHead>
                  {mode !== 'account' && <TableHead className="w-32">Account</TableHead>}
                  <TableHead className="w-28 text-right">Debit</TableHead>
                  <TableHead className="w-28 text-right">Credit</TableHead>
                  <TableHead className="w-32 text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* The carried-forward figure. Only shown on page 1: on later
                    pages the previous page's closing IS the opening, and
                    repeating it would read as a second transaction. */}
                {page === 1 && (
                  <TableRow className="bg-muted/30">
                    <TableCell colSpan={mode === 'account' ? 4 : 5} className="text-sm">
                      Opening balance
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(ledger?.opening ?? 0, currency)}
                    </TableCell>
                  </TableRow>
                )}

                {ledger?.entries.map((row, index) => (
                  <TableRow key={`${row.entryId}-${index}`}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(row.date)}
                    </TableCell>
                    <TableCell className="font-medium">{row.documentNumber}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.description || row.narration || row.sourceNumber || '—'}
                    </TableCell>
                    {mode !== 'account' && (
                      <TableCell className="text-muted-foreground">
                        {row.accountName}
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular-nums">
                      {row.debit > 0 ? formatMoney(row.debit, currency) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.credit > 0 ? formatMoney(row.credit, currency) : '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium tabular-nums',
                        row.runningBalance < 0 && 'text-destructive'
                      )}
                    >
                      {formatMoney(row.runningBalance, currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={mode === 'account' ? 3 : 4}>
                    Totals for the period
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(ledger?.totals.debit ?? 0, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(ledger?.totals.credit ?? 0, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(ledger?.closing ?? 0, currency)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}

          {ledger && ledger.pagination.pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {ledger.pagination.page} of {ledger.pagination.pages} ·{' '}
                {ledger.pagination.total} lines
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
                  disabled={page >= ledger.pagination.pages || loading}
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

function Figure({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn('mt-1 tabular-nums', emphasis ? 'text-2xl font-semibold' : 'text-lg')}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
