import { useState, useEffect } from 'react';
import {
  Globe,
  Store,
  Copy,
  CheckCircle2,
  ExternalLink,
  Palette,
  Save,
  Loader2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/services/api';

interface StoreSettings {
  _id?: string;
  storeSlug: string;
  storeName: string;
  tagline: string;
  logoUrl: string;
  themeColor: string;
  whatsappNumber: string;
  isActive: boolean;
}

const THEME_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981',
  '#3b82f6', '#ef4444', '#14b8a6', '#84cc16',
];

export function OnlineStorePage() {
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [form, setForm] = useState<StoreSettings>({
    storeSlug: '', storeName: '', tagline: '', logoUrl: '', themeColor: '#6366f1', whatsappNumber: '', isActive: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const storeUrl = `${window.location.origin}/store/${form.storeSlug}`;

  useEffect(() => {
    api.get('/online-store')
      .then((res) => {
        const data = res.data.data;
        setStore(data);
        setForm({
          storeSlug: data.storeSlug || '',
          storeName: data.storeName || '',
          tagline: data.tagline || '',
          logoUrl: data.logoUrl || '',
          themeColor: data.themeColor || '#6366f1',
          whatsappNumber: data.whatsappNumber || '',
          isActive: data.isActive || false,
        });
      })
      .catch(() => setError('Failed to load store settings.'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // First create if new
      if (!store?._id) {
        await api.put('/online-store', form);
      } else {
        await api.put('/online-store', form);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save store settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyUrl = () => {
    void navigator.clipboard.writeText(storeUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const update = (key: keyof StoreSettings, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Store className="w-6 h-6 text-primary" />
          Online Store
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Let customers browse and order from your public storefront — no login required for them.
        </p>
      </div>

      {/* Store URL card */}
      <Card className="border-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            Your Store URL
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              readOnly
              value={form.storeSlug ? storeUrl : 'Save a slug to get your URL'}
              className="font-mono text-xs bg-muted/40 text-muted-foreground flex-1"
            />
            <Button variant="outline" size="sm" onClick={handleCopyUrl} className="gap-1.5 shrink-0">
              {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {form.storeSlug && (
              <Button variant="outline" size="sm" asChild className="shrink-0">
                <a href={`/store/${form.storeSlug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </Button>
            )}
          </div>
          {/* Active toggle */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div>
              <p className="text-sm font-medium">Store is {form.isActive ? 'Live 🟢' : 'Offline 🔴'}</p>
              <p className="text-xs text-muted-foreground">{form.isActive ? 'Customers can browse and order.' : 'Customers see a "store offline" page.'}</p>
            </div>
            <button
              onClick={() => update('isActive', !form.isActive)}
              className={`transition-colors ${form.isActive ? 'text-emerald-500' : 'text-gray-300'}`}
            >
              {form.isActive
                ? <ToggleRight className="w-8 h-8" />
                : <ToggleLeft className="w-8 h-8" />
              }
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Settings card */}
      <Card className="border-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Store Settings</CardTitle>
          <CardDescription>Customize your storefront appearance</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Store Name *</Label>
              <Input value={form.storeName} onChange={(e) => update('storeName', e.target.value)} placeholder="My Awesome Shop" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">URL Slug *</Label>
              <Input
                value={form.storeSlug}
                onChange={(e) => update('storeSlug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="my-shop-name"
              />
              <p className="text-xs text-muted-foreground">Only lowercase letters, numbers, and dashes.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Tagline</Label>
              <Input value={form.tagline} onChange={(e) => update('tagline', e.target.value)} placeholder="Fresh produce delivered daily" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Logo URL</Label>
              <Input value={form.logoUrl} onChange={(e) => update('logoUrl', e.target.value)} placeholder="https://..." />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">WhatsApp Number</Label>
              <Input value={form.whatsappNumber} onChange={(e) => update('whatsappNumber', e.target.value)} placeholder="+91 98765 43210" />
            </div>
          </div>

          {/* Theme Color */}
          <div className="space-y-2">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" /> Theme Color
            </Label>
            <div className="flex flex-wrap gap-2">
              {THEME_COLORS.map((color) => (
                <button
                  key={color}
                  style={{ backgroundColor: color }}
                  onClick={() => update('themeColor', color)}
                  className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${
                    form.themeColor === color ? 'ring-2 ring-offset-2 ring-gray-800 scale-110' : ''
                  }`}
                />
              ))}
              <input
                type="color"
                value={form.themeColor}
                onChange={(e) => update('themeColor', e.target.value)}
                className="w-8 h-8 rounded-full cursor-pointer border-0"
                title="Custom color"
              />
            </div>
          </div>

          {/* Preview */}
          {form.storeName && (
            <div className="rounded-xl overflow-hidden border shadow-sm">
              <div style={{ backgroundColor: form.themeColor }} className="px-4 py-3 flex items-center gap-2.5 text-white">
                <Store className="w-5 h-5 opacity-80" />
                <div>
                  <p className="font-bold text-sm">{form.storeName}</p>
                  {form.tagline && <p className="text-white/70 text-xs">{form.tagline}</p>}
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 text-xs text-gray-500">
                Preview of your store header
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
          </Button>
        </CardContent>
      </Card>

      {/* Products visibility note */}
      <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
        <CardContent className="pt-4 pb-3 flex items-start gap-3">
          <span className="text-2xl">💡</span>
          <div className="text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300">Product Visibility</p>
            <p className="text-amber-700 dark:text-amber-400 text-xs mt-0.5">
              Only products with "Show on Online Store" enabled appear on your public storefront.
              You can toggle this per product in the Product edit form under <strong>Products → Edit → Online Store</strong>.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
