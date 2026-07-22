import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { brands, categories, units } from '@/services/catalog.service';
import type { Brand, Category, Unit } from '@/types';

type Kind = 'categories' | 'brands' | 'units';
type Row = (Category | Brand | Unit) & { productCount?: number };

const API = { categories, brands, units };

const META: Record<Kind, { title: string; blurb: string; singular: string }> = {
  categories: {
    title: 'Categories',
    blurb: 'Group products for filtering and reporting. One level of nesting is supported.',
    singular: 'category',
  },
  brands: {
    title: 'Brands',
    blurb: 'Who makes the product. Optional, but useful for filtering a large catalog.',
    singular: 'brand',
  },
  units: {
    title: 'Units',
    blurb:
      'How products are measured and sold. Units cannot be auto-created by the Excel import, because a decimal rule cannot be guessed from a name.',
    singular: 'unit',
  },
};

/**
 * One screen for all three product masters — they are the same shape, and
 * three near-identical settings pages would drift apart.
 *
 * The `productCount` column is what makes delete honest: it says up front why
 * a delete will deactivate rather than remove, instead of surprising the user
 * afterwards.
 */
/**
 * `kind` arrives as a prop, not a route param: the routes are the three
 * literal paths the user asked for (/products/categories, /brands, /units),
 * so there is no `:kind` segment to read and useParams would silently yield
 * undefined — rendering categories on all three tabs.
 */
export function MastersPage({ kind }: { kind: Kind }) {
  const navigate = useNavigate();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState({ name: '', symbol: '', description: '', allowsDecimal: true });

  const meta = META[kind];

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);
    try {
      setRows((await API[kind].list(true)) as Row[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this list');
    } finally {
      setLoading(false);
    }
  }, [kind, activeCompany]);

  useEffect(() => {
    setRows([]);
    resetForm();
    void load();
  }, [load, tenantVersion]);

  const resetForm = () => {
    setEditing(null);
    setForm({ name: '', symbol: '', description: '', allowsDecimal: true });
  };

  const startEdit = (row: Row) => {
    setEditing(row);
    setForm({
      name: row.name,
      symbol: 'symbol' in row ? row.symbol : '',
      description: 'description' in row ? (row.description ?? '') : '',
      allowsDecimal: 'allowsDecimal' in row ? row.allowsDecimal : true,
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    const payload: Record<string, unknown> =
      kind === 'units'
        ? { name: form.name.trim(), symbol: form.symbol.trim(), allowsDecimal: form.allowsDecimal }
        : { name: form.name.trim(), description: form.description.trim() };

    try {
      if (editing) {
        await API[kind].update(editing._id, payload);
      } else {
        await API[kind].create(payload as never);
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: Row) => {
    const inUse = (row.productCount ?? 0) > 0;
    const confirmed = window.confirm(
      inUse
        ? `${row.name} is used by ${row.productCount} product(s). It will be deactivated rather than deleted so those products keep their ${meta.singular}. Continue?`
        : `Delete ${row.name}?`
    );
    if (!confirmed) return;

    setError(null);
    try {
      const result = await API[kind].remove(row._id);
      setNotice(
        result.deleted
          ? `${row.name} was deleted.`
          : `${row.name} was deactivated — ${result.productCount} product(s) and ${result.childCount} sub-${meta.singular}(s) still reference it.`
      );
      if (editing?._id === row._id) resetForm();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete');
    }
  };

  const handleSeedUnits = async () => {
    setSaving(true);
    try {
      const created = await units.seedDefaults();
      setNotice(
        created > 0
          ? `Added ${created} default unit(s).`
          : 'Defaults were not added — this company already has units.'
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add defaults');
    } finally {
      setSaving(false);
    }
  };

  if (!activeCompany) {
    return (
      <p className="text-sm text-muted-foreground">
        Create or select a company to manage product masters.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/products"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Products
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold">Product masters</h1>
        <p className="text-sm text-muted-foreground">{meta.blurb}</p>
      </div>

      <Tabs
        value={kind}
        onValueChange={(next) => navigate(`/products/${next}`)}
      >
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
        </TabsList>
      </Tabs>

      {notice && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm">{notice}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Can permission="products.create">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {editing ? `Edit ${meta.singular}` : `Add ${meta.singular}`}
              </CardTitle>
              {editing && (
                <CardDescription>
                  <button
                    type="button"
                    onClick={resetForm}
                    className="inline-flex items-center gap-1 text-xs hover:underline"
                  >
                    <X className="h-3 w-3" />
                    Cancel edit
                  </button>
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="m-name">Name *</Label>
                  <Input
                    id="m-name"
                    required
                    maxLength={120}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>

                {kind === 'units' ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="m-symbol">Symbol *</Label>
                      <Input
                        id="m-symbol"
                        required
                        maxLength={12}
                        placeholder="kg"
                        value={form.symbol}
                        onChange={(e) => setForm({ ...form, symbol: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">Printed on invoices.</p>
                    </div>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-input"
                        checked={form.allowsDecimal}
                        onChange={(e) => setForm({ ...form, allowsDecimal: e.target.checked })}
                      />
                      <span>
                        Allows decimals
                        <span className="block text-xs text-muted-foreground">
                          Off for things sold whole — 2.5 pieces is not a quantity.
                        </span>
                      </span>
                    </label>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="m-desc">Description</Label>
                    <Input
                      id="m-desc"
                      maxLength={400}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </div>
                )}

                <Button type="submit" disabled={saving} className="w-full">
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {editing ? 'Save changes' : `Add ${meta.singular}`}
                </Button>
              </form>

              {kind === 'units' && rows.length === 0 && !loading && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-3 w-full"
                  disabled={saving}
                  onClick={() => void handleSeedUnits()}
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Add the 8 common units
                </Button>
              )}
            </CardContent>
          </Card>
        </Can>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{meta.title}</CardTitle>
            <CardDescription>
              {loading ? 'Loading…' : `${rows.length} ${meta.singular}(s)`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading && rows.length === 0 ? (
              <p className="flex items-center py-6 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </p>
            ) : rows.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                No {meta.singular}s yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    {kind === 'units' && <TableHead>Symbol</TableHead>}
                    <TableHead className="text-right">Products</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row._id}>
                      <TableCell>
                        {row.name}
                        {!row.isActive && (
                          <Badge variant="muted" className="ml-2 text-[10px]">
                            Inactive
                          </Badge>
                        )}
                        {kind === 'units' && 'allowsDecimal' in row && !row.allowsDecimal && (
                          <Badge variant="outline" className="ml-2 text-[10px]">
                            Whole numbers
                          </Badge>
                        )}
                      </TableCell>
                      {kind === 'units' && (
                        <TableCell className="font-mono text-xs">
                          {'symbol' in row ? row.symbol : ''}
                        </TableCell>
                      )}
                      <TableCell className="text-right text-muted-foreground">
                        {row.productCount ?? 0}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Can permission="products.update">
                            <button
                              onClick={() => startEdit(row)}
                              aria-label={`Edit ${row.name}`}
                              className="p-1 text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </Can>
                          <Can permission="products.delete">
                            <button
                              onClick={() => void handleDelete(row)}
                              aria-label={`Delete ${row.name}`}
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
