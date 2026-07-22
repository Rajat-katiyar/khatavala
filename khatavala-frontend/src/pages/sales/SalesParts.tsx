import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import * as customerService from '@/services/customer.service';
import type { Customer, SalesDocumentKind, SalesDocumentStatus } from '@/types';

/** Where each document type lives, in one place rather than inline everywhere. */
export const KIND_META: Record<
  SalesDocumentKind,
  { label: string; plural: string; path: string }
> = {
  quotations: { label: 'Quotation', plural: 'Quotations', path: '/sales/quotations' },
  orders: { label: 'Sales order', plural: 'Sales orders', path: '/sales/orders' },
  invoices: { label: 'Invoice', plural: 'Invoices', path: '/sales/invoices' },
};

/**
 * Status colours carry meaning and must not be decorative: anything needing
 * action is loud, anything settled is quiet, anything dead is muted.
 */
const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive' | 'muted'> =
  {
    Draft: 'muted',
    Sent: 'outline',
    Accepted: 'secondary',
    Rejected: 'destructive',
    Expired: 'muted',
    Converted: 'secondary',
    Confirmed: 'default',
    PartiallyDelivered: 'outline',
    Delivered: 'secondary',
    Cancelled: 'destructive',
    Unpaid: 'default',
    PartiallyPaid: 'outline',
    Paid: 'secondary',
  };

/** Statuses that read better with a space than in camel case. */
const STATUS_LABEL: Record<string, string> = {
  PartiallyPaid: 'Partly paid',
  PartiallyDelivered: 'Partly delivered',
};

export function StatusBadge({ status }: { status: SalesDocumentStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'outline'} className="text-[10px]">
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

/**
 * Customer picker with inline creation.
 *
 * The "add new" path matters more than it looks: a walk-in customer at the
 * counter is the common case, and bouncing the cashier to /customers to create
 * one — losing the half-built invoice — is how a fast entry screen stops being
 * fast. Creating inline keeps the invoice on screen.
 */
export function CustomerPicker({
  value,
  onSelect,
  disabled,
}: {
  value: Customer | null;
  onSelect: (customer: Customer | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim() || value) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const page = await customerService.listCustomers({ search: query, limit: 8 });
        if (!cancelled) {
          setResults(page.customers);
          setOpen(true);
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, value]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const createCustomer = async () => {
    setError(null);
    try {
      const customer = await customerService.createCustomer({
        name: newName.trim(),
        phone: newPhone.trim(),
      });
      onSelect(customer);
      setCreating(false);
      setNewName('');
      setNewPhone('');
      setQuery('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the customer');
    }
  };

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border border-input px-3 py-2 text-sm">
        <span>
          {value.name}
          {value.phone && <span className="text-muted-foreground"> · {value.phone}</span>}
        </span>
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => onSelect(null)}
          disabled={disabled}
        >
          Change
        </button>
      </div>
    );
  }

  if (creating) {
    return (
      <div className="space-y-3 rounded-md border border-input p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-customer-name">Name</Label>
            <Input
              id="new-customer-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Customer name"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-customer-phone">Phone</Label>
            <Input
              id="new-customer-phone"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="10-digit number"
            />
          </div>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            onClick={createCustomer}
            disabled={!newName.trim() || newPhone.trim().length < 7}
          >
            Add customer
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          disabled={disabled}
          placeholder="Search customer by name or phone…"
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="pl-8"
          autoComplete="off"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-3 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-background shadow-md">
          {results.map((customer) => (
            <li key={customer._id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  onSelect(customer);
                  setOpen(false);
                }}
              >
                <span>{customer.name}</span>
                <span className="text-xs text-muted-foreground">{customer.phone}</span>
              </button>
            </li>
          ))}
          <li className="border-t">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-primary hover:bg-accent"
              onClick={() => {
                setNewName(query);
                setCreating(true);
                setOpen(false);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              Add “{query}” as a new customer
            </button>
          </li>
        </ul>
      )}

      {!open && (
        <button
          type="button"
          className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setCreating(true)}
        >
          <Plus className="h-3 w-3" /> Add a new customer
        </button>
      )}
    </div>
  );
}

/** Right-aligned money cell styling, used across the sales tables. */
export const moneyCell = (className?: string) =>
  cn('text-right tabular-nums whitespace-nowrap', className);
