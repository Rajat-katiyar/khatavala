import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Check, Loader2, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Modal } from '@/components/ui/modal';
import { Can } from '@/components/Can';
import { useCompanyStore } from '@/store/companyStore';
import { cn, formatDate, formatMoney } from '@/lib/utils';
import * as accountingService from '@/services/accounting.service';
import type { Account, JournalEntry, JournalEntryPage, JournalSourceType } from '@/types';

/**
 * The day book, plus the manual entry form.
 *
 * The form's job is to make an unbalanced entry impossible to submit — the API
 * rejects one anyway, but discovering that after filling in six lines is a poor
 * way to learn the rule. The running debit/credit totals and the difference are
 * shown live, and the submit button stays disabled until they agree.
 */

const PAGE_SIZE = 25;

const SOURCE_TYPES: JournalSourceType[] = [
  'SalesInvoice', 'PurchaseInvoice', 'CustomerReceipt', 'SupplierPayment',
  'CreditNote', 'DebitNote', 'Manual', 'Contra', 'Reversal',
];

/** Automatic sources are muted; the two a human can create stand out. */
const SOURCE_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'muted'> = {
  Manual: 'default',
  Contra: 'default',
  Reversal: 'outline',
};

const SOURCE_LABEL: Record<string, string> = {
  SalesInvoice: 'Sales invoice',
  PurchaseInvoice: 'Purchase bill',
  CustomerReceipt: 'Receipt',
  SupplierPayment: 'Payment',
  CreditNote: 'Credit note',
  DebitNote: 'Debit note',
};

interface DraftLine {
  key: string;
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

const emptyLine = (index: number): DraftLine => ({
  key: `line-${index}-${Math.random().toString(36).slice(2, 8)}`,
  accountId: '',
  debit: '',
  credit: '',
  description: '',
});

const round2 = (value: number) => Math.round(value * 100) / 100;

export function JournalEntries() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currency = activeCompany?.currency ?? 'INR';

  const [data, setData] = useState<JournalEntryPage | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sourceType, setSourceType] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [contraOpen, setContraOpen] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(0), emptyLine(1)]);
  const [narration, setNarration] = useState('');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [contraFrom, setContraFrom] = useState('');
  const [contraTo, setContraTo] = useState('');
  const [contraAmount, setContraAmount] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await accountingService.listJournalEntries({
          sourceType: (sourceType || undefined) as JournalSourceType | undefined,
          from: from || undefined,
          to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
          page,
          limit: PAGE_SIZE,
        })
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load journal entries');
    } finally {
      setLoading(false);
    }
  }, [sourceType, from, to, page]);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  useEffect(() => {
    accountingService
      .listAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [tenantVersion]);

  /** Live totals — the whole point of the form. */
  const totals = useMemo(() => {
    const debit = round2(lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0));
    const credit = round2(lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0));
    return { debit, credit, difference: round2(debit - credit) };
  }, [lines]);

  const balanced = Math.abs(totals.difference) < 0.005 && totals.debit > 0;
  const linesUsable =
    lines.filter((line) => line.accountId && (Number(line.debit) || Number(line.credit)))
      .length >= 2;

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );

  const resetForm = () => {
    setLines([emptyLine(0), emptyLine(1)]);
    setNarration('');
    setDate('');
    setFormError(null);
  };

  const submit = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await accountingService.createJournalEntry({
        date: date || undefined,
        narration: narration.trim() || null,
        lines: lines
          .filter((line) => line.accountId && (Number(line.debit) || Number(line.credit)))
          .map((line) => ({
            accountId: line.accountId,
            debitAmount: Number(line.debit) || 0,
            creditAmount: Number(line.credit) || 0,
            description: line.description.trim() || null,
          })),
      });
      setFormOpen(false);
      resetForm();
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not post the entry');
    } finally {
      setSaving(false);
    }
  };

  const submitContra = async () => {
    setSaving(true);
    setFormError(null);
    try {
      await accountingService.createContraEntry({
        fromAccountId: contraFrom,
        toAccountId: contraTo,
        amount: Number(contraAmount),
      });
      setContraOpen(false);
      setContraAmount('');
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not post the contra entry');
    } finally {
      setSaving(false);
    }
  };

  const assetAccounts = accounts.filter((account) => account.accountType === 'Asset');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Journal entries</h1>
          <p className="text-sm text-muted-foreground">
            Every entry balances. Invoices, bills and payments post here
            automatically — these cannot be edited, only reversed.
          </p>
        </div>
        <Can permission="accounting.create">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setContraOpen(true)}>
              <ArrowLeftRight className="mr-2 h-4 w-4" /> Contra
            </Button>
            <Button
              onClick={() => {
                resetForm();
                setFormOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Manual entry
            </Button>
          </div>
        </Can>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">Day book</CardTitle>
          <div className="flex flex-wrap gap-2">
            <select
              value={sourceType}
              onChange={(e) => {
                setSourceType(e.target.value);
                setPage(1);
              }}
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All sources</option>
              {SOURCE_TYPES.map((option) => (
                <option key={option} value={option}>
                  {SOURCE_LABEL[option] ?? option}
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
          ) : data && data.entries.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">No entries yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Number</TableHead>
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead>Narration</TableHead>
                  <TableHead className="w-32">Source</TableHead>
                  <TableHead className="w-32 text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.entries.map((entry) => (
                  <>
                    <TableRow
                      key={entry._id}
                      className={cn(
                        'cursor-pointer',
                        entry.reversedByEntryId && 'opacity-60'
                      )}
                      onClick={() =>
                        setExpanded(expanded === entry._id ? null : entry._id)
                      }
                    >
                      <TableCell className="font-medium">
                        {entry.documentNumber}
                        {entry.reversedByEntryId && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Reversed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(entry.date)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {entry.narration ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={SOURCE_VARIANT[entry.sourceType] ?? 'muted'}
                          className="text-[10px]"
                        >
                          {SOURCE_LABEL[entry.sourceType] ?? entry.sourceType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(entry.totalDebit, currency)}
                      </TableCell>
                    </TableRow>

                    {expanded === entry._id && (
                      <TableRow key={`${entry._id}-lines`}>
                        <TableCell colSpan={5} className="bg-muted/30">
                          <LineDetail entry={entry} currency={currency} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}

          {data && data.pagination.pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Page {data.pagination.page} of {data.pagination.pages} ·{' '}
                {data.pagination.total} entries
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

      {/* ------------------------- Manual entry ------------------------- */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Manual journal entry"
        description="Debits must equal credits before this can be posted."
        className="max-w-3xl"
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="je-date">Date</Label>
              <Input
                id="je-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="je-narration">Narration</Label>
              <Input
                id="je-narration"
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                placeholder="What is this entry for?"
              />
            </div>
          </div>

          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.key} className="grid grid-cols-[1fr_110px_110px_36px] gap-2">
                <select
                  value={line.accountId}
                  onChange={(e) => updateLine(line.key, { accountId: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Select account…</option>
                  {accounts.map((account) => (
                    <option key={account._id} value={account._id}>
                      {account.code ? `${account.code} · ` : ''}
                      {account.accountName}
                    </option>
                  ))}
                </select>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Debit"
                  value={line.debit}
                  onChange={(e) =>
                    // Typing in one column clears the other: a line carrying
                    // both is rejected by the API, so the form does not let the
                    // user build one.
                    updateLine(line.key, { debit: e.target.value, credit: '' })
                  }
                  className="h-9 text-right"
                />
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Credit"
                  value={line.credit}
                  onChange={(e) =>
                    updateLine(line.key, { credit: e.target.value, debit: '' })
                  }
                  className="h-9 text-right"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  disabled={lines.length <= 2}
                  onClick={() =>
                    setLines((current) => current.filter((l) => l.key !== line.key))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setLines((current) => [...current, emptyLine(current.length)])}
            >
              <Plus className="mr-2 h-3.5 w-3.5" /> Add line
            </Button>
          </div>

          <div
            className={cn(
              'flex items-center justify-between rounded-md border p-3 text-sm',
              balanced
                ? 'border-emerald-500/40 bg-emerald-500/5'
                : 'border-amber-500/40 bg-amber-500/5'
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              {balanced ? (
                <>
                  <Check className="h-4 w-4 text-emerald-600" /> Balanced
                </>
              ) : (
                <>
                  <X className="h-4 w-4 text-amber-600" />
                  Out by {formatMoney(Math.abs(totals.difference), currency)}
                </>
              )}
            </span>
            <span className="tabular-nums">
              Dr {formatMoney(totals.debit, currency)} · Cr{' '}
              {formatMoney(totals.credit, currency)}
            </span>
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!balanced || !linesUsable || saving} onClick={submit}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Post entry
            </Button>
          </div>
        </div>
      </Modal>

      {/* ---------------------------- Contra ---------------------------- */}
      <Modal
        open={contraOpen}
        onClose={() => setContraOpen(false)}
        title="Contra entry"
        description="Move money between your own cash and bank accounts."
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contra-from">From</Label>
              <select
                id="contra-from"
                value={contraFrom}
                onChange={(e) => setContraFrom(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select…</option>
                {assetAccounts.map((account) => (
                  <option key={account._id} value={account._id}>
                    {account.accountName}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contra-to">To</Label>
              <select
                id="contra-to"
                value={contraTo}
                onChange={(e) => setContraTo(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Select…</option>
                {assetAccounts
                  .filter((account) => account._id !== contraFrom)
                  .map((account) => (
                    <option key={account._id} value={account._id}>
                      {account.accountName}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contra-amount">Amount</Label>
            <Input
              id="contra-amount"
              type="number"
              min="0"
              step="any"
              value={contraAmount}
              onChange={(e) => setContraAmount(e.target.value)}
            />
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setContraOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                saving || !contraFrom || !contraTo || !(Number(contraAmount) > 0)
              }
              onClick={submitContra}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Post contra
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function LineDetail({ entry, currency }: { entry: JournalEntry; currency: string }) {
  return (
    <div className="space-y-1 py-1">
      {entry.lines.map((line, index) => (
        <div
          key={line._id ?? index}
          className="grid grid-cols-[1fr_120px_120px] gap-2 text-sm"
        >
          <Link
            to={`/accounting/ledger/${line.accountId}`}
            className="truncate hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Indented so debits and credits read as a T-account would. */}
            <span className={cn(line.creditAmount > 0 && 'pl-6')}>{line.accountName}</span>
          </Link>
          <span className="text-right tabular-nums">
            {line.debitAmount > 0 ? formatMoney(line.debitAmount, currency) : ''}
          </span>
          <span className="text-right tabular-nums">
            {line.creditAmount > 0 ? formatMoney(line.creditAmount, currency) : ''}
          </span>
        </div>
      ))}
      {entry.sourceNumber && (
        <p className="pt-1 text-xs text-muted-foreground">
          Source: {entry.sourceNumber}
        </p>
      )}
    </div>
  );
}
