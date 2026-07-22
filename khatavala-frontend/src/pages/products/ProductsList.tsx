import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Barcode,
  Download,
  LayoutGrid,
  List,
  Loader2,
  Package,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
} from 'lucide-react';
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
import * as productService from '@/services/product.service';
import { brands as brandApi, categories as categoryApi } from '@/services/catalog.service';
import type { Brand, Category, Product, ProductStats, StockStatus } from '@/types';
import { ProductImportDrawer } from './ProductImportDrawer';
import { BarcodePrintModal } from './BarcodePrintModal';
import { StockBadge, refName, unitSymbol } from './ProductParts';

type SortField = 'name' | 'sku' | 'sellingPrice' | 'purchasePrice' | 'currentStock' | 'createdAt';

const PAGE_SIZE = 24;

export function ProductsList() {
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const tenantVersion = useCompanyStore((s) => s.tenantVersion);
  const currency = activeCompany?.currency ?? 'INR';
  const navigate = useNavigate();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brandList, setBrandList] = useState<Brand[]>([]);
  const [stats, setStats] = useState<ProductStats | null>(null);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [stockStatus, setStockStatus] = useState<StockStatus>('all');
  const [sortBy, setSortBy] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'list' | 'grid'>('list');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [barcodeOpen, setBarcodeOpen] = useState(false);

  // Debounced so typing a name is one request, not one per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      categoryId: categoryId || undefined,
      brandId: brandId || undefined,
      stockStatus,
      sortBy,
      sortDir,
    }),
    [debouncedSearch, categoryId, brandId, stockStatus, sortBy, sortDir]
  );

  const load = useCallback(async () => {
    if (!activeCompany) return;
    setLoading(true);
    setError(null);
    try {
      const [list, statsData] = await Promise.all([
        productService.listProducts({ ...filters, page, limit: PAGE_SIZE }),
        productService.getStats(),
      ]);
      setProducts(list.products);
      setPages(list.pagination.pages);
      setTotal(list.pagination.total);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load products');
    } finally {
      setLoading(false);
    }
  }, [activeCompany, filters, page]);

  // Masters change rarely; loaded once per tenant rather than per filter change.
  const loadMasters = useCallback(async () => {
    if (!activeCompany) return;
    try {
      const [cats, brs] = await Promise.all([categoryApi.list(), brandApi.list()]);
      setCategories(cats);
      setBrandList(brs);
    } catch {
      // A failed master load leaves the filters empty but the list usable —
      // not worth blocking the page over.
    }
  }, [activeCompany]);

  // tenantVersion is the refetch trigger: switching companies bumps it, which
  // re-runs this effect with the newly scoped access token in place.
  useEffect(() => {
    setProducts([]);
    setSelected(new Set());
    void load();
  }, [load, tenantVersion]);

  useEffect(() => {
    void loadMasters();
  }, [loadMasters, tenantVersion]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir(field === 'name' || field === 'sku' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allOnPageSelected = products.length > 0 && products.every((p) => selected.has(p._id));

  const handleDelete = async (product: Product) => {
    const confirmed = window.confirm(
      `Remove ${product.name}? If it still has stock on hand it will be deactivated rather than deleted.`
    );
    if (!confirmed) return;
    try {
      const result = await productService.deleteProduct(product._id);
      if (result.deactivated) {
        setError(`${product.name} was deactivated instead — ${result.reason}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this product');
    }
  };

  const statCards = useMemo(
    () => [
      { label: 'Products', value: String(stats?.total ?? 0) },
      { label: 'Low stock', value: String(stats?.lowStock ?? 0) },
      { label: 'Out of stock', value: String(stats?.outOfStock ?? 0) },
      { label: 'Stock value (at cost)', value: formatMoney(stats?.stockValue ?? 0, currency) },
    ],
    [stats, currency]
  );

  if (!activeCompany) {
    return (
      <p className="text-sm text-muted-foreground">
        Create or select a company to manage products.
      </p>
    );
  }

  const selectedProducts = products.filter((p) => selected.has(p._id));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Products</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? 'Loading…' : `${total} product(s) in ${activeCompany.name}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to="/products/categories">
              <Settings2 className="mr-2 h-4 w-4" />
              Masters
            </Link>
          </Button>
          <Button variant="outline" onClick={() => void productService.exportProducts(filters)}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Can permission="products.create">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Import
            </Button>
            <Button onClick={() => navigate('/products/new')}>
              <Plus className="mr-2 h-4 w-4" />
              Add product
            </Button>
          </Can>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
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
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Search name, SKU or barcode…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search products"
              />
            </div>

            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by category"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={brandId}
              onChange={(e) => {
                setBrandId(e.target.value);
                setPage(1);
              }}
              aria-label="Filter by brand"
            >
              <option value="">All brands</option>
              {brandList.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                </option>
              ))}
            </select>

            <select
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={stockStatus}
              onChange={(e) => {
                setStockStatus(e.target.value as StockStatus);
                setPage(1);
              }}
              aria-label="Filter by stock status"
            >
              <option value="all">Any stock level</option>
              <option value="in">In stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </select>

            <div className="ml-auto flex items-center gap-2">
              {selected.size > 0 && (
                <Button variant="outline" size="sm" onClick={() => setBarcodeOpen(true)}>
                  <Barcode className="mr-2 h-4 w-4" />
                  Print {selected.size} barcode(s)
                </Button>
              )}
              <div className="flex rounded-md border">
                <button
                  type="button"
                  onClick={() => setView('list')}
                  aria-label="List view"
                  aria-pressed={view === 'list'}
                  className={`p-2 ${view === 'list' ? 'bg-muted' : ''}`}
                >
                  <List className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setView('grid')}
                  aria-label="Grid view"
                  aria-pressed={view === 'grid'}
                  className={`p-2 ${view === 'grid' ? 'bg-muted' : ''}`}
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {loading && products.length === 0 ? (
            <p className="flex items-center py-8 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading products…
            </p>
          ) : products.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">
              {debouncedSearch || categoryId || brandId || stockStatus !== 'all'
                ? 'No products match these filters.'
                : 'No products yet. Add one, or import your catalog from Excel.'}
            </p>
          ) : view === 'list' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all on this page"
                      className="h-4 w-4 rounded border-input"
                      checked={allOnPageSelected}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          products.forEach((p) =>
                            e.target.checked ? next.add(p._id) : next.delete(p._id)
                          );
                          return next;
                        })
                      }
                    />
                  </TableHead>
                  <SortableHead field="name" activeField={sortBy} direction={sortDir} onSort={toggleSort}>
                    Product
                  </SortableHead>
                  <SortableHead field="sku" activeField={sortBy} direction={sortDir} onSort={toggleSort}>
                    SKU
                  </SortableHead>
                  <TableHead>Category</TableHead>
                  <SortableHead
                    field="sellingPrice"
                    activeField={sortBy}
                    direction={sortDir}
                    onSort={toggleSort}
                    className="text-right"
                  >
                    Selling
                  </SortableHead>
                  <SortableHead
                    field="currentStock"
                    activeField={sortBy}
                    direction={sortDir}
                    onSort={toggleSort}
                    className="text-right"
                  >
                    Stock
                  </SortableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((product) => (
                  <TableRow key={product._id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select ${product.name}`}
                        className="h-4 w-4 rounded border-input"
                        checked={selected.has(product._id)}
                        onChange={() => toggleSelected(product._id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/products/${product._id}/edit`}
                        className="font-medium hover:underline"
                      >
                        {product.name}
                      </Link>
                      {!product.isActive && (
                        <Badge variant="muted" className="ml-2 text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {refName(product.categoryId) ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMoney(product.sellingPrice, currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <StockBadge product={product} />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Can permission="products.update">
                          <Link
                            to={`/products/${product._id}/edit`}
                            aria-label={`Edit ${product.name}`}
                            className="p-1 text-muted-foreground hover:text-foreground"
                          >
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Can>
                        <Can permission="products.delete">
                          <button
                            onClick={() => void handleDelete(product)}
                            aria-label={`Remove ${product.name}`}
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
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => {
                const image = productService.resolveImageUrl(product.imageUrl);
                return (
                  <div
                    key={product._id}
                    className={`relative rounded-lg border p-3 transition-colors ${
                      selected.has(product._id) ? 'border-primary bg-muted/40' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${product.name}`}
                      className="absolute left-4 top-4 h-4 w-4 rounded border-input"
                      checked={selected.has(product._id)}
                      onChange={() => toggleSelected(product._id)}
                    />
                    <div className="mb-3 flex h-32 items-center justify-center overflow-hidden rounded bg-muted">
                      {image ? (
                        <img
                          src={image}
                          alt={product.name}
                          className="h-full w-full object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <Package className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>
                    <Link
                      to={`/products/${product._id}/edit`}
                      className="line-clamp-2 font-medium hover:underline"
                    >
                      {product.name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">{product.sku}</p>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="font-semibold">
                        {formatMoney(product.sellingPrice, currency)}
                      </span>
                      <StockBadge product={product} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {refName(product.categoryId) ?? 'Uncategorised'} · per{' '}
                      {unitSymbol(product.primaryUnitId) ?? '—'}
                    </p>
                  </div>
                );
              })}
            </div>
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

      <ProductImportDrawer
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          void load();
          void loadMasters();
        }}
      />
      <BarcodePrintModal
        open={barcodeOpen}
        onOpenChange={setBarcodeOpen}
        products={selectedProducts}
        currency={currency}
      />
    </div>
  );
}
