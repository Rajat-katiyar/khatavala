import { useState } from 'react';
import { Camera, Upload, CheckCircle2, Loader2, ArrowLeft, RefreshCw, AlertCircle } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api';
import { formatMoney } from '@/lib/utils';
import { useCompanyStore } from '@/store/companyStore';
import * as purchaseService from '@/services/purchase.service';

interface DraftItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
}

interface OcrDraftBill {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  lines: DraftItem[];
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  rawText: string;
}

export function ScanBillPage() {
  const navigate = useNavigate();
  const activeCompany = useCompanyStore((s) => s.activeCompany);
  const currency = activeCompany?.currency ?? 'INR';

  const [scanning, setScanning] = useState(false);
  const [draft, setDraft] = useState<OcrDraftBill | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleUploadAndScan = async (selectedFile: File) => {
    setScanning(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const { data } = await api.post<{ success: boolean; data: OcrDraftBill }>('/purchase/scan-ocr', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setDraft(data.data);
    } catch (err) {
      console.error(err);
      setMessage('OCR processing failed. Please try another image.');
    } finally {
      setScanning(false);
    }
  };

  const handleLineChange = (index: number, field: keyof DraftItem, val: any) => {
    if (!draft) return;
    const updatedLines = [...draft.lines];
    const line = { ...updatedLines[index], [field]: val };
    line.total = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
    updatedLines[index] = line;

    const subtotal = updatedLines.reduce((s, l) => s + l.total, 0);
    const taxTotal = subtotal * 0.18;
    const grandTotal = subtotal + taxTotal;

    setDraft({ ...draft, lines: updatedLines, subtotal, taxTotal, grandTotal });
  };

  const handleConfirmPurchaseBill = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await purchaseService.createDocument('invoices', {
        supplierId: '000000000000000000000000', // default vendor placeholder
        supplierInvoiceNumber: draft.invoiceNumber,
        supplierInvoiceDate: draft.invoiceDate,
        lineItems: draft.lines.map((l) => ({
          productId: '000000000000000000000000',
          quantity: l.quantity,
          unitPrice: l.unitPrice,
        })),
      });

      setMessage('Purchase Bill successfully created and confirmed!');
      setTimeout(() => navigate('/purchase/bills'), 1500);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1">
            <Link to="/purchase/bills">
              <ArrowLeft className="mr-2 h-4 w-4" /> Purchase Bills
            </Link>
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">AI OCR Scan-to-Bill</h1>
          <p className="text-sm text-muted-foreground">
            Photograph or upload physical vendor bills to automatically extract line items into a draft purchase invoice.
          </p>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{message}</span>
        </div>
      )}

      {!draft ? (
        /* Image Upload Dropzone */
        <Card className="border-dashed border-2 p-12 text-center hover:border-primary/50 transition-colors">
          <div className="flex flex-col items-center gap-4 max-w-md mx-auto">
            <div className="p-4 rounded-full bg-primary/10 text-primary">
              <Camera className="w-8 h-8" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Upload Scanned Purchase Bill</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Supports JPG, PNG, and PDF invoices up to 10MB. OCR automatically extracts products and prices.
              </p>
            </div>

            <label className="cursor-pointer">
              <Input
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleUploadAndScan(f);
                }}
              />
              <Button disabled={scanning} className="w-full gap-2 pointer-events-none">
                {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {scanning ? 'Extracting OCR Data…' : 'Select Invoice Image'}
              </Button>
            </label>
          </div>
        </Card>
      ) : (
        /* OCR Draft Review & Editable Form */
        <div className="space-y-6">
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <Badge variant="outline" className="text-xs uppercase font-bold text-primary mb-1">
                    OCR Draft Review
                  </Badge>
                  <CardTitle className="text-lg">Scanned Bill #{draft.invoiceNumber}</CardTitle>
                  <CardDescription>Supplier: {draft.supplierName}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setDraft(null)} className="gap-1.5 text-xs">
                  <RefreshCw className="w-3.5 h-3.5" /> Scan Another Image
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Extracted Product Description</TableHead>
                      <TableHead className="w-24 text-right">Qty</TableHead>
                      <TableHead className="w-32 text-right">Unit Rate</TableHead>
                      <TableHead className="w-32 text-right">Total Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draft.lines.map((line, idx) => (
                      <TableRow key={idx}>
                        <TableCell>
                          <Input
                            value={line.productName}
                            onChange={(e) => handleLineChange(idx, 'productName', e.target.value)}
                            className="h-8 text-xs font-medium"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={line.quantity}
                            onChange={(e) => handleLineChange(idx, 'quantity', Number(e.target.value))}
                            className="h-8 text-xs text-right font-bold"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            value={line.unitPrice}
                            onChange={(e) => handleLineChange(idx, 'unitPrice', Number(e.target.value))}
                            className="h-8 text-xs text-right"
                          />
                        </TableCell>
                        <TableCell className="text-right font-bold text-xs">
                          {formatMoney(line.total, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex justify-between items-center pt-2">
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-500" />
                  <span>Review line items for accuracy before creating official bill.</span>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-xs text-muted-foreground">
                    Subtotal: <span className="font-semibold text-foreground">{formatMoney(draft.subtotal, currency)}</span>
                  </p>
                  <p className="text-base font-bold text-primary">
                    Grand Total: {formatMoney(draft.grandTotal, currency)}
                  </p>
                </div>
              </div>

              <Button
                onClick={handleConfirmPurchaseBill}
                disabled={saving}
                className="w-full h-11 text-sm font-bold gap-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Confirm & Create Purchase Bill
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
