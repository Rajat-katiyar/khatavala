import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ImageIcon, Loader2, Package, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCompanyStore } from '@/store/companyStore';
import { formatMoney } from '@/lib/utils';
import * as productService from '@/services/product.service';
import { brands as brandApi, categories as categoryApi, units as unitApi } from '@/services/catalog.service';
import type { Brand, Category, Product, Unit } from '@/types';
import { refId } from './ProductParts';

interface FormState {
  name: string;
  sku: string;
  barcode: string;
  categoryId: string;
  brandId: string;
  hsnCode: string;
  gstPercentage: string;
  primaryUnitId: string;
  secondaryUnitId: string;
  conversionFactor: string;
  purchasePrice: string;
  sellingPrice: string;
  mrp: string;
  wholesalePrice: string;
  openingStock: string;
  minStockLevel: string;
  maxStockLevel: string;
  trackBatch: boolean;
  trackExpiry: boolean;
  trackSerial: boolean;
  isActive: boolean;
  isOnlineStoreVisible: boolean;
  onlineStoreDescription: string;
}

const EMPTY: FormState = {
  name: '',
  sku: '',
  barcode: '',
  categoryId: '',
  brandId: '',
  hsnCode: '',
  gstPercentage: '',
  primaryUnitId: '',
  secondaryUnitId: '',
  conversionFactor: '',
  purchasePrice: '',
  sellingPrice: '',
  mrp: '',
  wholesalePrice: '',
  openingStock: '',
  minStockLevel: '',
  maxStockLevel: '',
  trackBatch: false,
  trackExpiry: false,
  trackSerial: false,
  isActive: true,
  isOnlineStoreVisible: false,
  onlineStoreDescription: '',
};

const toForm = (product: Product): FormState => ({
  name: product.name,
  sku: product.sku,
  barcode: product.barcode ?? '',
  categoryId: refId(product.categoryId),
  brandId: refId(product.brandId),
  hsnCode: product.hsnCode ?? '',
  gstPercentage: String(product.gstPercentage ?? ''),
  primaryUnitId: refId(product.primaryUnitId),
  secondaryUnitId: refId(product.secondaryUnitId),
  conversionFactor: product.conversionFactor ? String(product.conversionFactor) : '',
  purchasePrice: String(product.purchasePrice ?? ''),
  sellingPrice: String(product.sellingPrice ?? ''),
  mrp: String(product.mrp ?? ''),
  wholesalePrice: String(product.wholesalePrice ?? ''),
  openingStock: String(product.openingStock ?? ''),
  minStockLevel: String(product.minStockLevel ?? ''),
  maxStockLevel: String(product.maxStockLevel ?? ''),
  trackBatch: product.trackBatch,
  trackExpiry: product.trackExpiry,
  trackSerial: product.trackSerial,
  isActive: product.isActive,
  isOnlineStoreVisible: (product as any).isOnlineStoreVisible ?? false,
  onlineStoreDescription: (product as any).onlineStoreDescription ?? '',
});

function Toggle({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

export function ProductForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [form, setForm] = useState<FormState>(EMPTY);
  const [product, setProduct] = useState<Product | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brandList, setBrandList] = useState<Brand[]>([]);
  const [unitList, setUnitList] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('basic');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cats, brs, uns] = await Promise.all([
        categoryApi.list(),
        brandApi.list(),
        unitApi.list(),
      ]);

      // A company with no units cannot create its first product at all, so
      // seed the defaults rather than presenting an empty required dropdown.
      let resolvedUnits = uns;
      if (uns.length === 0) {
        await unitApi.seedDefaults();
        resolvedUnits = await unitApi.list();
      }

      setCategories(cats);
      setBrandList(brs);
      setUnitList(resolvedUnits);

      if (id) {
        const existing = await productService.getProduct(id);
        setProduct(existing);
        setForm(toForm(existing));
      } else {
        setForm({ ...EMPTY, primaryUnitId: resolvedUnits[0]?._id ?? '' });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this product');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const num = (value: string) => (value === '' ? undefined : Number(value));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      sku: form.sku.trim(),
      barcode: form.barcode.trim() || null,
      categoryId: form.categoryId || null,
      brandId: form.brandId || null,
      hsnCode: form.hsnCode.trim() || null,
      gstPercentage: num(form.gstPercentage) ?? 0,
      primaryUnitId: form.primaryUnitId,
      secondaryUnitId: form.secondaryUnitId || null,
      // The pair travels together — clearing the unit must clear the factor,
      // or the API rejects the whole update.
      conversionFactor: form.secondaryUnitId ? (num(form.conversionFactor) ?? null) : null,
      purchasePrice: num(form.purchasePrice) ?? 0,
      sellingPrice: num(form.sellingPrice) ?? 0,
      mrp: num(form.mrp) ?? 0,
      wholesalePrice: num(form.wholesalePrice) ?? 0,
      minStockLevel: num(form.minStockLevel) ?? 0,
      maxStockLevel: num(form.maxStockLevel) ?? 0,
      trackBatch: form.trackBatch,
      trackExpiry: form.trackExpiry,
      trackSerial: form.trackSerial,
      isActive: form.isActive,
      isOnlineStoreVisible: form.isOnlineStoreVisible,
      onlineStoreDescription: form.onlineStoreDescription.trim() || null,
    };

    try {
      if (isEdit && id) {
        // openingStock is deliberately absent: stock changes are movements,
        // owned by Inventory, and the API rejects it here.
        await productService.updateProduct(id, payload);
        await load();
      } else {
        const created = await productService.createProduct({
          ...payload,
          openingStock: num(form.openingStock) ?? 0,
        });
        navigate(`/products/${created._id}/edit`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this product');
      // Errors are almost always a field on Basic Info; jumping back there
      // beats showing a message about a tab the user cannot see.
      setTab('basic');
    } finally {
      setSaving(false);
    }
  };

  const handleImage = async (file: File | null) => {
    if (!file || !id) return;
    setUploading(true);
    setError(null);
    try {
      setProduct(await productService.uploadProductImage(id, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that image');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRemoveImage = async () => {
    if (!id) return;
    setUploading(true);
    try {
      setProduct(await productService.deleteProductImage(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that image');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center py-8 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading…
      </p>
    );
  }

  const margin =
    num(form.sellingPrice) && num(form.purchasePrice)
      ? Number(form.sellingPrice) - Number(form.purchasePrice)
      : null;
  const marginPct =
    margin !== null && Number(form.purchasePrice) > 0
      ? (margin / Number(form.purchasePrice)) * 100
      : null;

  const imageUrl = productService.resolveImageUrl(product?.imageUrl);

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {isEdit ? form.name || 'Edit product' : 'New product'}
        </h1>
        {isEdit && product && (
          <p className="text-sm text-muted-foreground">
            Stock on hand: <strong>{product.currentStock}</strong>
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit}>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="basic">Basic info</TabsTrigger>
            <TabsTrigger value="pricing">Pricing</TabsTrigger>
            <TabsTrigger value="stock">Stock settings</TabsTrigger>
            <TabsTrigger value="store">Online Store</TabsTrigger>
            <TabsTrigger value="image">Image</TabsTrigger>
          </TabsList>

          <TabsContent value="basic">
            <Card>
              <CardHeader>
                <CardTitle>Basic info</CardTitle>
                <CardDescription>What this product is and how it is identified.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="p-name">Name *</Label>
                  <Input
                    id="p-name"
                    required
                    maxLength={200}
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-sku">SKU *</Label>
                  <Input
                    id="p-sku"
                    required
                    maxLength={64}
                    className="font-mono uppercase"
                    value={form.sku}
                    onChange={(e) => set('sku', e.target.value.toUpperCase())}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-barcode">Barcode</Label>
                  <Input
                    id="p-barcode"
                    maxLength={64}
                    className="font-mono"
                    placeholder="Scan or type"
                    value={form.barcode}
                    onChange={(e) => set('barcode', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Left blank, labels fall back to the SKU.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-category">Category</Label>
                  <select
                    id="p-category"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.categoryId}
                    onChange={(e) => set('categoryId', e.target.value)}
                  >
                    <option value="">Uncategorised</option>
                    {categories.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-brand">Brand</Label>
                  <select
                    id="p-brand"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.brandId}
                    onChange={(e) => set('brandId', e.target.value)}
                  >
                    <option value="">No brand</option>
                    {brandList.map((b) => (
                      <option key={b._id} value={b._id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-unit">Primary unit *</Label>
                  <select
                    id="p-unit"
                    required
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.primaryUnitId}
                    onChange={(e) => set('primaryUnitId', e.target.value)}
                  >
                    {unitList.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.name} ({u.symbol})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-unit2">Secondary unit</Label>
                  <select
                    id="p-unit2"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={form.secondaryUnitId}
                    onChange={(e) => {
                      set('secondaryUnitId', e.target.value);
                      if (!e.target.value) set('conversionFactor', '');
                    }}
                  >
                    <option value="">None</option>
                    {unitList
                      .filter((u) => u._id !== form.primaryUnitId)
                      .map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.name} ({u.symbol})
                        </option>
                      ))}
                  </select>
                </div>
                {form.secondaryUnitId && (
                  <div className="space-y-1.5">
                    <Label htmlFor="p-factor">Conversion factor *</Label>
                    <Input
                      id="p-factor"
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={form.conversionFactor}
                      onChange={(e) => set('conversionFactor', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      How many primary units make one secondary unit — a case of 24 bottles is 24.
                    </p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="p-hsn">HSN code</Label>
                  <Input
                    id="p-hsn"
                    maxLength={12}
                    className="font-mono uppercase"
                    value={form.hsnCode}
                    onChange={(e) => set('hsnCode', e.target.value.toUpperCase())}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-gst">GST %</Label>
                  <Input
                    id="p-gst"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={form.gstPercentage}
                    onChange={(e) => set('gstPercentage', e.target.value)}
                  />
                </div>
                <label className="flex items-center gap-2 sm:col-span-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input"
                    checked={form.isActive}
                    onChange={(e) => set('isActive', e.target.checked)}
                  />
                  <span className="text-sm">Active — appears in sales and purchase pickers</span>
                </label>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pricing">
            <Card>
              <CardHeader>
                <CardTitle>Pricing</CardTitle>
                <CardDescription>
                  All four are stored independently — a discounted line still prints its MRP.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="p-purchase">Purchase price</Label>
                  <Input
                    id="p-purchase"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.purchasePrice}
                    onChange={(e) => set('purchasePrice', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-selling">Selling price</Label>
                  <Input
                    id="p-selling"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.sellingPrice}
                    onChange={(e) => set('sellingPrice', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-mrp">MRP</Label>
                  <Input
                    id="p-mrp"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.mrp}
                    onChange={(e) => set('mrp', e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-wholesale">Wholesale price</Label>
                  <Input
                    id="p-wholesale"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.wholesalePrice}
                    onChange={(e) => set('wholesalePrice', e.target.value)}
                  />
                </div>

                {margin !== null && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm sm:col-span-2">
                    Margin: <strong>{formatMoney(margin, currency)}</strong>
                    {marginPct !== null && <> ({marginPct.toFixed(1)}% on cost)</>}
                    {margin < 0 && (
                      <span className="ml-2 text-destructive">
                        — you are selling below cost
                      </span>
                    )}
                    {Number(form.mrp) > 0 && Number(form.sellingPrice) > Number(form.mrp) && (
                      <span className="ml-2 text-destructive">
                        — selling price is above MRP
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="stock">
            <Card>
              <CardHeader>
                <CardTitle>Stock settings</CardTitle>
                <CardDescription>
                  Reorder levels and what each movement must record.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {!isEdit ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="p-opening">Opening stock</Label>
                    <Input
                      id="p-opening"
                      type="number"
                      step="any"
                      value={form.openingStock}
                      onChange={(e) => set('openingStock', e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      What is on the shelf today. Set once — later changes are stock movements.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm sm:col-span-2">
                    Opening stock was <strong>{product?.openingStock ?? 0}</strong>; current stock
                    is <strong>{product?.currentStock ?? 0}</strong>. Stock changes are recorded as
                    movements by the Inventory module, not edited here.
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="p-min">Minimum stock level</Label>
                  <Input
                    id="p-min"
                    type="number"
                    min="0"
                    step="any"
                    value={form.minStockLevel}
                    onChange={(e) => set('minStockLevel', e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    At or below this, the product shows as low stock. Zero disables the warning.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-max">Maximum stock level</Label>
                  <Input
                    id="p-max"
                    type="number"
                    min="0"
                    step="any"
                    value={form.maxStockLevel}
                    onChange={(e) => set('maxStockLevel', e.target.value)}
                  />
                </div>

                <div className="grid gap-3 sm:col-span-2 sm:grid-cols-3">
                  <Toggle
                    id="t-batch"
                    label="Track batch"
                    hint="Each movement records a batch number."
                    checked={form.trackBatch}
                    onChange={(v) => set('trackBatch', v)}
                  />
                  <Toggle
                    id="t-expiry"
                    label="Track expiry"
                    hint="Each movement records an expiry date."
                    checked={form.trackExpiry}
                    onChange={(v) => set('trackExpiry', v)}
                  />
                  <Toggle
                    id="t-serial"
                    label="Track serial"
                    hint="Each unit carries its own serial number."
                    checked={form.trackSerial}
                    onChange={(v) => set('trackSerial', v)}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="store">
            <Card>
              <CardHeader>
                <CardTitle>Online Store Settings</CardTitle>
                <CardDescription>
                  Configure whether this product appears on your public storefront.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Toggle
                  id="t-store-visible"
                  label="Show on Online Store"
                  hint="When enabled, customers can view and add this item to cart on your public storefront."
                  checked={form.isOnlineStoreVisible}
                  onChange={(v) => set('isOnlineStoreVisible', v)}
                />
                <div className="space-y-1.5">
                  <Label htmlFor="p-store-desc">Storefront Short Description</Label>
                  <Input
                    id="p-store-desc"
                    maxLength={300}
                    placeholder="Short highlight for storefront product card..."
                    value={form.onlineStoreDescription}
                    onChange={(e) => set('onlineStoreDescription', e.target.value)}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="image">
            <Card>
              <CardHeader>
                <CardTitle>Image</CardTitle>
                <CardDescription>
                  JPEG, PNG, WebP or GIF, up to 5 MB.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!isEdit ? (
                  <p className="text-sm text-muted-foreground">
                    Save the product first — the image is attached to an existing product.
                  </p>
                ) : (
                  <>
                    <div className="flex h-48 w-48 items-center justify-center overflow-hidden rounded-md border bg-muted">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={form.name}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <Package className="h-10 w-10 text-muted-foreground" />
                      )}
                    </div>

                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => void handleImage(e.target.files?.[0] ?? null)}
                    />

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={uploading}
                        onClick={() => fileRef.current?.click()}
                      >
                        {uploading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="mr-2 h-4 w-4" />
                        )}
                        {imageUrl ? 'Replace image' : 'Upload image'}
                      </Button>
                      {imageUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          disabled={uploading}
                          onClick={() => void handleRemoveImage()}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove
                        </Button>
                      )}
                    </div>

                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ImageIcon className="h-3.5 w-3.5" />
                      Uploads apply immediately — they are not part of Save changes.
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/products')}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create product'}
          </Button>
        </div>
      </form>
    </div>
  );
}
