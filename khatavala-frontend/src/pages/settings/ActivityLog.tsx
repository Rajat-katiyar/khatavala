import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useCompanyStore } from '@/store/companyStore';
import * as rbac from '@/services/rbac.service';
import type { AuditLogEntry, AuditLogPage } from '@/types';

/** create/update/delete read very differently at a glance; colour says which. */
function ActionBadge({ action }: { action: string }) {
  const variant = action.startsWith('delete') || action.includes('revoke')
    ? 'destructive'
    : action.startsWith('create') || action.includes('invite')
      ? 'default'
      : 'secondary';
  return <Badge variant={variant}>{action}</Badge>;
}

/**
 * Renders a stored oldValue/newValue blob. These are arbitrary per entity, so
 * the row shows a compact key: value list and falls back to JSON for anything
 * that isn't a flat object.
 */
function ValueView({ label, value }: { label: string; value: unknown }) {
  if (value == null || (typeof value === 'object' && Object.keys(value).length === 0)) {
    return null;
  }

  const entries =
    typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : null;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {entries ? (
        <dl className="space-y-0.5">
          {entries.map(([key, val]) => (
            <div key={key} className="flex gap-2 text-xs">
              <dt className="min-w-32 font-mono text-muted-foreground">{key}</dt>
              <dd className="break-all font-mono">
                {typeof val === 'object' ? JSON.stringify(val) : String(val)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function LogRow({ log }: { log: AuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(log.oldValue || log.newValue);

  return (
    <>
      <tr className="border-b last:border-0">
        <td className="py-2 align-top">
          {hasDetail ? (
            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Hide details' : 'Show details'}
              className="text-muted-foreground hover:text-foreground"
            >
              {open ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </td>
        <td className="whitespace-nowrap py-2 align-top text-muted-foreground">
          {new Date(log.timestamp).toLocaleString()}
        </td>
        <td className="py-2 align-top">
          {/* A hard-deleted user leaves the ref dangling; show the id, not a blank. */}
          {log.user?.fullName ?? (
            <span className="text-muted-foreground">
              {log.userId ? `User ${log.userId.slice(-6)}` : 'Unknown'}
            </span>
          )}
        </td>
        <td className="py-2 align-top">
          <ActionBadge action={log.action} />
        </td>
        <td className="py-2 align-top">
          {log.entityName}
          {log.entityId && (
            <span className="ml-1 font-mono text-xs text-muted-foreground">
              {log.entityId.slice(-6)}
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/30 last:border-0">
          <td />
          <td colSpan={4} className="space-y-3 py-3 pr-4">
            <ValueView label="Before" value={log.oldValue} />
            <ValueView label="After" value={log.newValue} />
            {log.ip && (
              <p className="text-xs text-muted-foreground">
                From {log.ip}
                {log.userAgent ? ` · ${log.userAgent.slice(0, 80)}` : ''}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

const emptyFilters = {
  action: '',
  entityName: '',
  from: '',
  to: '',
};

export function SettingsActivityLog() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [page, setPage] = useState<AuditLogPage | null>(null);
  const [options, setOptions] = useState<{ actions: string[]; entities: string[] }>({
    actions: [],
    entities: [],
  });
  const [filters, setFilters] = useState(emptyFilters);
  const [pageNumber, setPageNumber] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);
    try {
      setPage(await rbac.listAuditLogs({ ...filters, page: pageNumber, limit: 50 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the activity log');
    } finally {
      setLoading(false);
    }
  }, [activeCompany, filters, pageNumber]);

  useEffect(() => {
    void load();
  }, [load, tenantVersion]);

  // Filter dropdowns are populated from what the log actually contains, so they
  // never offer an action that would return zero rows.
  useEffect(() => {
    if (!activeCompany) return;
    rbac.auditFilterOptions().then(setOptions).catch(() => undefined);
  }, [activeCompany, tenantVersion]);

  const setFilter = (key: keyof typeof emptyFilters, value: string) => {
    setPageNumber(1); // a new filter invalidates the current page number
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  if (!activeCompany) {
    return (
      <p className="text-sm text-muted-foreground">
        Select a company to view its activity log.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Activity log</h1>
        <p className="text-sm text-muted-foreground">
          Every change made in {activeCompany.name}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="f-action">Action</Label>
              <Select
                id="f-action"
                value={filters.action}
                onChange={(e) => setFilter('action', e.target.value)}
              >
                <option value="">All actions</option>
                {options.actions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="f-entity">Entity</Label>
              <Select
                id="f-entity"
                value={filters.entityName}
                onChange={(e) => setFilter('entityName', e.target.value)}
              >
                <option value="">All entities</option>
                {options.entities.map((entity) => (
                  <option key={entity} value={entity}>
                    {entity}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="f-from">From</Label>
              <Input
                id="f-from"
                type="date"
                value={filters.from}
                onChange={(e) => setFilter('from', e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="f-to">To</Label>
              <Input
                id="f-to"
                type="date"
                value={filters.to}
                onChange={(e) => setFilter('to', e.target.value)}
              />
            </div>

            <div className="flex items-end">
              <Button
                variant="outline"
                onClick={() => {
                  setFilters(emptyFilters);
                  setPageNumber(1);
                }}
              >
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entries</CardTitle>
          <CardDescription>
            {loading
              ? 'Loading…'
              : page
                ? `${page.total} entr${page.total === 1 ? 'y' : 'ies'}`
                : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}

          {!loading && page && page.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing recorded yet for these filters.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="w-8 py-2" />
                    <th className="py-2 font-medium">When</th>
                    <th className="py-2 font-medium">Who</th>
                    <th className="py-2 font-medium">Action</th>
                    <th className="py-2 font-medium">Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {page?.logs.map((log) => <LogRow key={log._id} log={log} />)}
                </tbody>
              </table>
            </div>
          )}

          {page && page.pages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={pageNumber <= 1}
                onClick={() => setPageNumber((n) => n - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {page.page} of {page.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pageNumber >= page.pages}
                onClick={() => setPageNumber((n) => n + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
