import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { Can } from '@/components/Can';
import { useCompanyStore } from '@/store/companyStore';
import { cn } from '@/lib/utils';
import * as accountingService from '@/services/accounting.service';
import type { AccountNode, AccountType } from '@/types';

/**
 * The chart of accounts as a tree.
 *
 * System accounts are marked and cannot be deleted or retyped — the posting
 * service resolves them by role, and retyping one would flip the sign of every
 * figure already posted into it. The lock icon says so before the user tries.
 */

const ACCOUNT_TYPES: AccountType[] = ['Asset', 'Liability', 'Equity', 'Income', 'Expense'];

/** Type colours are a legend, not decoration: they group the tree at a glance. */
const TYPE_VARIANT: Record<AccountType, 'default' | 'secondary' | 'outline' | 'muted'> = {
  Asset: 'default',
  Liability: 'secondary',
  Equity: 'outline',
  Income: 'secondary',
  Expense: 'muted',
};

export function ChartOfAccounts() {
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [tree, setTree] = useState<AccountNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountNode | null>(null);
  const [parentFor, setParentFor] = useState<AccountNode | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('Asset');
  const [code, setCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await accountingService.getAccountTree();
      setTree(fetched);
      // Groups open by default — a collapsed chart shows six words and tells
      // the user nothing about their books.
      setExpanded(new Set(fetched.map((node) => node._id)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the chart of accounts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const openCreate = (parent: AccountNode | null) => {
    setEditing(null);
    setParentFor(parent);
    setName('');
    // A child almost always shares its parent's type — the API requires it.
    setType(parent?.accountType ?? 'Asset');
    setCode('');
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (account: AccountNode) => {
    setEditing(account);
    setParentFor(null);
    setName(account.accountName);
    setType(account.accountType);
    setCode(account.code ?? '');
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await accountingService.updateAccount(editing._id, {
          accountName: name.trim(),
          code: code.trim() || null,
          // Type is only sent for a non-system account; the API rejects it on a
          // system one and the field is disabled above.
          ...(editing.isSystem ? {} : { accountType: type }),
        });
      } else {
        await accountingService.createAccount({
          accountName: name.trim(),
          accountType: type,
          code: code.trim() || null,
          parentAccountId: parentFor?._id ?? null,
        });
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the account');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (account: AccountNode) => {
    setError(null);
    try {
      const result = await accountingService.deleteAccount(account._id);
      if (result.deactivated) {
        setError(
          `${account.accountName} has postings against it, so it was deactivated rather than deleted.`
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the account');
    }
  };

  const renderNode = (node: AccountNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node._id);

    return (
      <div key={node._id}>
        <div
          className={cn(
            'group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/50',
            !node.isActive && 'opacity-50'
          )}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggle(node._id)}
            className={cn('shrink-0', !hasChildren && 'invisible')}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {node.code && (
            <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
              {node.code}
            </span>
          )}

          <a
            href={`/accounting/ledger/${node._id}`}
            className="flex-1 truncate text-sm hover:underline"
          >
            {node.accountName}
          </a>

          <Badge variant={TYPE_VARIANT[node.accountType]} className="text-[10px]">
            {node.accountType}
          </Badge>

          {node.isSystem && (
            <Lock
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-label="System account"
            />
          )}

          <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Can permission="accounting.create">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Add a child account"
                onClick={() => openCreate(node)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </Can>
            <Can permission="accounting.update">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Edit"
                onClick={() => openEdit(node)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </Can>
            {!node.isSystem && (
              <Can permission="accounting.delete">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Remove"
                  onClick={() => remove(node)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Can>
            )}
          </div>
        </div>

        {isOpen && node.children.map((child) => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Chart of accounts</h1>
          <p className="text-sm text-muted-foreground">
            Every journal line posts to one of these. Locked accounts are used by
            automatic postings and cannot be removed.
          </p>
        </div>
        <Can permission="accounting.create">
          <Button onClick={() => openCreate(null)}>
            <Plus className="mr-2 h-4 w-4" /> New account
          </Button>
        </Can>
      </div>

      {error && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
          {error}
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </p>
          ) : tree.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">No accounts yet.</p>
          ) : (
            <div className="-mx-2">{tree.map((node) => renderNode(node, 0))}</div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit account' : 'New account'}
        description={
          parentFor ? `Created under ${parentFor.accountName}` : undefined
        }
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="account-name">Account name</Label>
            <Input
              id="account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-type">Type</Label>
              <select
                id="account-type"
                value={type}
                onChange={(e) => setType(e.target.value as AccountType)}
                // A system account's type is fixed, and a child must match its
                // parent — so the control is disabled rather than allowed to
                // produce a request the API will reject.
                disabled={!!editing?.isSystem || !!parentFor}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                {ACCOUNT_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {editing?.isSystem && (
                <p className="text-xs text-muted-foreground">
                  A system account&apos;s type is fixed — changing it would flip the
                  sign of everything already posted to it.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-code">Code</Label>
              <Input
                id="account-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Optional, e.g. 1150"
              />
            </div>
          </div>

          {formError && <p className="text-sm text-destructive">{formError}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button disabled={saving || !name.trim()} onClick={save}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? 'Save changes' : 'Create account'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
