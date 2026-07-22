import { useState } from 'react';
import {
  Sparkles,
  Copy,
  CheckCircle2,
  Loader2,
  Wand2,
  Package,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/services/api';

export function SmartAdsPage() {
  const [form, setForm] = useState({ productName: '', sellingPrice: '', mrp: '', description: '' });
  const [variants, setVariants] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await api.post('/campaigns/smart-ads/generate', form);
      setVariants(res.data.data.variants || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (idx: number, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" />
          Smart Ad Copy Generator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate ready-to-use WhatsApp & Meta ad copy for your products instantly.
        </p>
      </div>

      {/* Input card */}
      <Card className="border-primary/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" />
            Product Details
          </CardTitle>
          <CardDescription>Enter product info to generate 3 ad copy variants</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Product Name *</Label>
              <Input value={form.productName} onChange={(e) => update('productName', e.target.value)} placeholder="Basmati Rice 5kg" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Selling Price (₹) *</Label>
              <Input type="number" value={form.sellingPrice} onChange={(e) => update('sellingPrice', e.target.value)} placeholder="299" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">MRP (₹) <span className="text-muted-foreground font-normal">optional</span></Label>
              <Input type="number" value={form.mrp} onChange={(e) => update('mrp', e.target.value)} placeholder="350" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Product Description <span className="text-muted-foreground font-normal">optional</span></Label>
              <Input value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Long grain, extra fragrant" />
            </div>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={loading || !form.productName || !form.sellingPrice}
            className="gap-2 w-full sm:w-auto"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
            {loading ? 'Generating...' : 'Generate Ad Copy'}
          </Button>
        </CardContent>
      </Card>

      {/* Output variants */}
      {variants.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-base font-semibold text-muted-foreground">✨ Generated Variants — copy one to your WhatsApp or Meta ads</h2>
          {variants.map((variant, idx) => (
            <Card key={idx} className="border-primary/5 hover:shadow-md transition-shadow">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                        Variant {idx + 1}
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap font-sans text-sm text-foreground leading-relaxed bg-muted/30 rounded-xl p-4">
                      {variant}
                    </pre>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(idx, variant)}
                    className="gap-1.5 shrink-0 text-xs"
                  >
                    {copiedIdx === idx
                      ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Copied!</>
                      : <><Copy className="w-3.5 h-3.5" /> Copy</>
                    }
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 text-xs text-amber-700 dark:text-amber-400">
            💡 <strong>Tip:</strong> These are suggestions. Review before posting. Paste directly into WhatsApp Business broadcast, Meta Ads Manager, or your marketing tool.
          </div>
        </div>
      )}
    </div>
  );
}
