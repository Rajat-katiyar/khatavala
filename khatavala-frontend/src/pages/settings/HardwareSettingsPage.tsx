import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Printer,
  Scale,
  CreditCard,
  CheckCircle2,
  Copy,
  Wifi,
  AlertCircle,
  Loader2,
  Bluetooth,
  Usb,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api';

// ─── Thermal Printer helpers via Web USB / BT (best-effort) ─────────────────
const ESC = '\x1B';
const GS = '\x1D';
const INIT = `${ESC}@`;
const BOLD_ON = `${ESC}E\x01`;
const BOLD_OFF = `${ESC}E\x00`;
const CENTER = `${ESC}a\x01`;
const LEFT = `${ESC}a\x00`;
const CUT = `${GS}V\x41\x00`;
const LINE = `${ESC}d\x01`;

function buildTestReceiptText(companyName: string): string {
  return (
    INIT +
    CENTER +
    BOLD_ON +
    companyName +
    '\n' +
    BOLD_OFF +
    '--------------------------------\n' +
    LEFT +
    'Test Print\n' +
    'Khatavala POS System\n' +
    `Date: ${new Date().toLocaleString()}\n` +
    '--------------------------------\n' +
    CENTER +
    'Thank you!\n' +
    LINE +
    CUT
  );
}

export function HardwareSettingsPage() {
  const { t } = useTranslation();

  // ── Printer state ────────────────────────────────────────────────────────
  const [printerStatus, setPrinterStatus] = useState<'idle' | 'connecting' | 'success' | 'error'>('idle');
  const [printerMsg, setPrinterMsg] = useState('');

  // ── Scale state ──────────────────────────────────────────────────────────
  const [scaleStatus, setScaleStatus] = useState<'idle' | 'connecting' | 'reading' | 'success' | 'error'>('idle');
  const [weight, setWeight] = useState<number | null>(null);
  const [manualWeight, setManualWeight] = useState('');
  const [serialSupported] = useState<boolean>('serial' in navigator);

  // ── EDC state ────────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${api.defaults.baseURL?.replace('/api', '')}/api/payments/edc-callback`;

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleTestPrint = async () => {
    setPrinterStatus('connecting');
    setPrinterMsg('');

    try {
      if ('usb' in navigator) {
        // Web USB — request any USB device
        const device = await (navigator as any).usb.requestDevice({ filters: [] });
        await device.open();
        await device.selectConfiguration(1);
        await device.claimInterface(0);
        const encoder = new TextEncoder();
        const data = encoder.encode(buildTestReceiptText('Khatavala'));
        await device.transferOut(1, data);
        await device.close();
        setPrinterStatus('success');
        setPrinterMsg(t('hardware.printer.testPrintSuccess'));
      } else if ('bluetooth' in navigator) {
        // Minimal Bluetooth ESC/POS (Nordic UART / SPP)
        const device = await (navigator as any).bluetooth.requestDevice({
          acceptAllDevices: true,
          optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb'],
        });
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
        const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
        const encoder = new TextEncoder();
        await characteristic.writeValue(encoder.encode(buildTestReceiptText('Khatavala')));
        device.gatt.disconnect();
        setPrinterStatus('success');
        setPrinterMsg(t('hardware.printer.testPrintSuccess'));
      } else {
        // Simulate success in unsupported browsers — still shows the receipt
        await new Promise((r) => setTimeout(r, 800));
        window.print();
        setPrinterStatus('success');
        setPrinterMsg('Window print dialog opened (no Web USB/BT available in this browser).');
      }
    } catch (err: any) {
      if (err?.name === 'NotFoundError') {
        setPrinterStatus('idle');
        setPrinterMsg('No printer selected.');
      } else {
        setPrinterStatus('error');
        setPrinterMsg(err?.message || 'Printer connection failed.');
      }
    }
  };

  const handleReadScale = async () => {
    if (!serialSupported) {
      setScaleStatus('error');
      return;
    }
    setScaleStatus('connecting');
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 9600 });

      const reader = port.readable.getReader();
      setScaleStatus('reading');

      let raw = '';
      const timeout = setTimeout(() => reader.cancel(), 3000);
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          raw += new TextDecoder().decode(value);
          const numMatch = raw.match(/[\d.]+/);
          if (numMatch) {
            setWeight(parseFloat(numMatch[0]));
            setScaleStatus('success');
            break;
          }
        }
      } finally {
        clearTimeout(timeout);
        reader.releaseLock();
      }
      await port.close();
    } catch {
      setScaleStatus('error');
    }
  };

  const handleCopyWebhook = () => {
    void navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('hardware.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">{t('hardware.subtitle')}</p>
      </div>

      {/* ── Thermal Printer ─────────────────────────────────────────────────── */}
      <Card className="border-primary/10 hover:shadow-md transition-shadow">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Printer className="w-4 h-4 text-primary" />
            {t('hardware.printer.title')}
          </CardTitle>
          <CardDescription>{t('hardware.printer.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="gap-1 text-xs">
              <Usb className="w-3 h-3" /> Web USB
            </Badge>
            <Badge variant="outline" className="gap-1 text-xs">
              <Bluetooth className="w-3 h-3" /> Bluetooth ESC/POS
            </Badge>
            <Badge variant="outline" className="gap-1 text-xs">
              <Wifi className="w-3 h-3" /> Network (window.print)
            </Badge>
          </div>

          <Button
            onClick={handleTestPrint}
            disabled={printerStatus === 'connecting'}
            className="gap-2"
          >
            {printerStatus === 'connecting' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : printerStatus === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <Printer className="w-4 h-4" />
            )}
            {printerStatus === 'connecting'
              ? t('hardware.printer.connecting')
              : t('hardware.printer.testPrint')}
          </Button>

          {printerMsg && (
            <p
              className={`text-xs flex items-center gap-1.5 ${
                printerStatus === 'error' ? 'text-destructive' : 'text-emerald-600'
              }`}
            >
              {printerStatus === 'error' ? (
                <AlertCircle className="w-3.5 h-3.5" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              {printerMsg}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Weighing Scale ──────────────────────────────────────────────────── */}
      <Card className="border-primary/10 hover:shadow-md transition-shadow">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Scale className="w-4 h-4 text-amber-500" />
            {t('hardware.scale.title')}
          </CardTitle>
          <CardDescription>{t('hardware.scale.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {serialSupported ? (
            <>
              <Button
                variant="outline"
                onClick={handleReadScale}
                disabled={scaleStatus === 'connecting' || scaleStatus === 'reading'}
                className="gap-2"
              >
                {scaleStatus === 'connecting' || scaleStatus === 'reading' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Scale className="w-4 h-4" />
                )}
                {t('hardware.scale.read')}
              </Button>

              {weight !== null && (
                <div className="p-3 rounded-lg border bg-muted/40 text-sm font-semibold">
                  {t('hardware.scale.weight')}: <span className="text-primary text-lg">{weight} kg</span>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4" /> {t('hardware.scale.noSupport')}
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('hardware.scale.manualEntry')}</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={manualWeight}
                    onChange={(e) => setManualWeight(e.target.value)}
                    className="w-36 h-9 text-sm"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setWeight(parseFloat(manualWeight) || 0)}
                    disabled={!manualWeight}
                  >
                    Set
                  </Button>
                </div>
                {weight !== null && (
                  <p className="text-xs text-muted-foreground">
                    {t('hardware.scale.weight')}: <span className="font-bold text-foreground">{weight} kg</span>
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── EDC Card Terminal ───────────────────────────────────────────────── */}
      <Card className="border-primary/10 hover:shadow-md transition-shadow">
        <CardHeader>
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-emerald-500" />
            {t('hardware.edc.title')}
          </CardTitle>
          <CardDescription>{t('hardware.edc.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">{t('hardware.edc.webhookEndpoint')}</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={webhookUrl}
                className="font-mono text-xs h-9 bg-muted/50 text-muted-foreground"
              />
              <Button variant="outline" size="sm" className="gap-1.5 text-xs shrink-0" onClick={handleCopyWebhook}>
                {copied ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    {t('hardware.edc.copied')}
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    {t('hardware.edc.webhookCopy')}
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-muted/40 border text-xs text-muted-foreground leading-relaxed">
            <p className="font-semibold text-foreground mb-1">Integration Instructions</p>
            <p>{t('hardware.edc.instructions')}</p>
            <ul className="mt-2 space-y-1 list-disc list-inside">
              <li>POST to the endpoint with <code className="bg-muted px-1 rounded">invoiceId</code>, <code className="bg-muted px-1 rounded">amount</code>, and <code className="bg-muted px-1 rounded">transactionRef</code>.</li>
              <li>Khatavala verifies the amount matches and marks the invoice as <strong>Paid</strong>.</li>
              <li>A <code className="bg-muted px-1 rounded">x-edc-signature</code> header (HMAC-SHA256) will be validated when a secret is configured.</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
