import { useState } from 'react';
import { Download, Upload, CheckCircle2, FileCode, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api';

interface TallySummary {
  productsImported: number;
  customersImported: number;
  errors: string[];
}

export function TallySyncPage() {
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<TallySummary | null>(null);

  const handleImport = async (file: File) => {
    setImporting(true);
    setSummary(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data } = await api.post<{ success: boolean; data: TallySummary }>('/tally/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setSummary(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setImporting(false);
    }
  };

  const handleDownloadTallyXml = () => {
    window.open(`${api.defaults.baseURL}/tally/export`, '_blank');
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tally ERP Data Interoperability</h1>
        <p className="text-sm text-muted-foreground">
          Bi-directional XML sync to migrate Stock Items, Ledgers, and Sales Vouchers between Khatavala and Tally ERP 9 / TallyPrime.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Import Tally XML Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Upload className="w-4 h-4 text-primary" /> Import Tally XML / CSV
            </CardTitle>
            <CardDescription>Upload Tally XML export files to populate products & ledgers.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block">
              <Input
                type="file"
                accept=".xml,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleImport(f);
                }}
              />
              <Button disabled={importing} className="w-full h-11 gap-2 pointer-events-none">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCode className="w-4 h-4" />}
                {importing ? 'Processing Tally XML…' : 'Select Tally XML / CSV File'}
              </Button>
            </label>

            {summary && (
              <div className="p-3 bg-muted/40 rounded-lg border text-xs space-y-2">
                <div className="flex items-center gap-1.5 text-emerald-600 font-bold">
                  <CheckCircle2 className="w-4 h-4" /> Import Complete
                </div>
                <p>
                  • Stock Items Imported: <span className="font-bold">{summary.productsImported}</span>
                </p>
                <p>
                  • Ledgers Imported: <span className="font-bold">{summary.customersImported}</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Export to Tally Card */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Download className="w-4 h-4 text-emerald-500" /> Export to Tally Format
            </CardTitle>
            <CardDescription>Download Khatavala data in Tally-compatible XML for double-entry sync.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Generates a standard Tally XML envelope containing Stock Items, Sundry Debtors ledgers, and posted Sales Vouchers.
            </p>

            <Button onClick={handleDownloadTallyXml} variant="outline" className="w-full h-11 gap-2">
              <Download className="w-4 h-4 text-emerald-500" />
              Download Tally XML File (.xml)
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
