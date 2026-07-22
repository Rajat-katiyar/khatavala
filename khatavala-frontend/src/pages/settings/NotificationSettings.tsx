import { useEffect, useState } from 'react';
import { Mail, MessageSquare, Send, Save, Eye, Sparkles, CheckCircle2, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import * as notifService from '@/services/notification.service';
import type { NotificationConfigPayload, NotificationTemplatePayload } from '@/services/notification.service';

const PLACEHOLDERS = [
  '{{customerName}}',
  '{{invoiceNumber}}',
  '{{amount}}',
  '{{dueDate}}',
  '{{companyName}}',
];

export function NotificationSettings() {
  const [activeTab, setActiveTab] = useState<'email' | 'whatsapp' | 'sms' | 'templates'>('email');
  const [config, setConfig] = useState<NotificationConfigPayload | null>(null);
  const [templates, setTemplates] = useState<NotificationTemplatePayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Template Form state
  const [selectedType, setSelectedType] = useState<'InvoiceSend' | 'PaymentReminder' | 'LowStockAlert'>('InvoiceSend');
  const [templateChannel, setTemplateChannel] = useState<'email' | 'whatsapp' | 'sms'>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    setLoading(true);
    Promise.all([
      notifService.getNotificationConfig(),
      notifService.getNotificationTemplates(),
    ])
      .then(([cfg, tpls]) => {
        setConfig(cfg);
        setTemplates(tpls);
      })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Error loading notification settings'))
      .finally(() => setLoading(false));
  }, []);

  // Update template form when selection changes
  useEffect(() => {
    const found = templates.find((t) => t.templateType === selectedType && t.channel === templateChannel);
    if (found) {
      setSubject(found.subject || '');
      setBody(found.body || '');
    } else {
      if (selectedType === 'InvoiceSend') {
        setSubject('Tax Invoice {{invoiceNumber}} from {{companyName}}');
        setBody('Dear {{customerName}},\n\nPlease find attached Tax Invoice {{invoiceNumber}} for {{amount}}.\n\nThank you!');
      } else if (selectedType === 'PaymentReminder') {
        setSubject('Payment Reminder: Invoice {{invoiceNumber}}');
        setBody('Dear {{customerName}},\n\nInvoice {{invoiceNumber}} for {{amount}} was due on {{dueDate}}.\n\nPlease arrange payment.');
      } else {
        setSubject('Low Stock Alert');
        setBody('Attention Admin,\n\nProduct is low on stock.');
      }
    }
  }, [selectedType, templateChannel, templates]);

  const handleSaveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      await notifService.updateNotificationConfig(config);
      setMessage('Notification settings saved successfully!');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplate = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await notifService.upsertNotificationTemplate({
        templateType: selectedType,
        channel: templateChannel,
        subject,
        body,
        isActive: true,
      });
      setTemplates((prev) => {
        const filtered = prev.filter((t) => !(t.templateType === selectedType && t.channel === templateChannel));
        return [...filtered, updated];
      });
      setMessage('Template updated successfully!');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const insertPlaceholder = (ph: string) => {
    setBody((prev) => `${prev} ${ph}`);
  };

  const previewBody = body
    .replace(/\{\{\s*customerName\s*\}\}/g, 'Rohan Sharma')
    .replace(/\{\{\s*invoiceNumber\s*\}\}/g, 'INV-2026-0042')
    .replace(/\{\{\s*amount\s*\}\}/g, '₹ 15,400.00')
    .replace(/\{\{\s*dueDate\s*\}\}/g, '25/07/2026')
    .replace(/\{\{\s*companyName\s*\}\}/g, 'Khatavala Traders');

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notification Channels & Templates</h1>
          <p className="text-sm text-muted-foreground">
            Configure SMTP Email, WhatsApp Cloud API, SMS Gateways and customized message templates.
          </p>
        </div>

        <Button variant="outline" size="sm" asChild className="gap-2">
          <Link to="/settings/notifications/history">
            <History className="w-4 h-4" />
            Sent History Log
          </Link>
        </Button>
      </div>

      {message && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{message}</span>
        </div>
      )}

      {/* Tabs Bar */}
      <div className="flex items-center gap-2 border-b pb-2">
        <button
          onClick={() => setActiveTab('email')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'email' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <Mail className="w-4 h-4" /> Email (SMTP)
        </button>

        <button
          onClick={() => setActiveTab('whatsapp')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'whatsapp' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <MessageSquare className="w-4 h-4" /> WhatsApp
        </button>

        <button
          onClick={() => setActiveTab('sms')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'sms' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <Send className="w-4 h-4" /> SMS Gateway
        </button>

        <button
          onClick={() => setActiveTab('templates')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            activeTab === 'templates' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <Sparkles className="w-4 h-4" /> Templates
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Loading settings…</div>
      ) : (
        <>
          {/* TAB 1: EMAIL SMTP */}
          {activeTab === 'email' && config && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Mail className="w-4 h-4 text-primary" />
                  SMTP Email Server Configuration
                </CardTitle>
                <CardDescription>
                  Send invoices, PDF attachments & reminders via your custom domain or Mailtrap / SendGrid SMTP.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>SMTP Host</Label>
                    <Input
                      placeholder="smtp.mailtrap.io or smtp.gmail.com"
                      value={config.emailConfig.smtpHost}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          emailConfig: { ...config.emailConfig, smtpHost: e.target.value },
                        })
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>SMTP Port</Label>
                    <Input
                      type="number"
                      placeholder="587"
                      value={config.emailConfig.smtpPort}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          emailConfig: { ...config.emailConfig, smtpPort: Number(e.target.value) },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>SMTP Username</Label>
                    <Input
                      placeholder="smtp_user_id"
                      value={config.emailConfig.smtpUser}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          emailConfig: { ...config.emailConfig, smtpUser: e.target.value },
                        })
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>SMTP Password</Label>
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={config.emailConfig.smtpPass}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          emailConfig: { ...config.emailConfig, smtpPass: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Sender From Email</Label>
                    <Input
                      placeholder="billing@yourdomain.com"
                      value={config.emailConfig.fromEmail}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          emailConfig: { ...config.emailConfig, fromEmail: e.target.value },
                        })
                      }
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Sender Name</Label>
                    <Input
                      placeholder="Khatavala Invoicing"
                      value={config.emailConfig.fromName}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          emailConfig: { ...config.emailConfig, fromName: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <Button onClick={handleSaveConfig} disabled={saving} className="gap-2">
                    <Save className="w-4 h-4" /> Save SMTP Settings
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* TAB 2: WHATSAPP CLOUD API */}
          {activeTab === 'whatsapp' && config && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-emerald-500" />
                  Meta WhatsApp Cloud API Configuration
                </CardTitle>
                <CardDescription>
                  Send instant WhatsApp bill notifications directly to customer mobile numbers.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>WhatsApp Phone Number ID</Label>
                  <Input
                    placeholder="1098765432109"
                    value={config.whatsappConfig.phoneNumberId}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        whatsappConfig: { ...config.whatsappConfig, phoneNumberId: e.target.value },
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Permanent Access Token</Label>
                  <Input
                    type="password"
                    placeholder="EAAG..."
                    value={config.whatsappConfig.accessToken}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        whatsappConfig: { ...config.whatsappConfig, accessToken: e.target.value },
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Sender Phone Number</Label>
                  <Input
                    placeholder="+919876543210"
                    value={config.whatsappConfig.senderNumber}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        whatsappConfig: { ...config.whatsappConfig, senderNumber: e.target.value },
                      })
                    }
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <Button onClick={handleSaveConfig} disabled={saving} className="gap-2">
                    <Save className="w-4 h-4" /> Save WhatsApp Settings
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* TAB 3: SMS GATEWAY */}
          {activeTab === 'sms' && config && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Send className="w-4 h-4 text-blue-500" />
                  SMS Gateway Configuration (MSG91 / Twilio)
                </CardTitle>
                <CardDescription>
                  Send SMS reminders and transactional alerts to Indian numbers.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label>SMS Provider API Key</Label>
                  <Input
                    type="password"
                    placeholder="API Key"
                    value={config.smsConfig.apiKey}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        smsConfig: { ...config.smsConfig, apiKey: e.target.value },
                      })
                    }
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>DLT Approved Sender ID (6-chars)</Label>
                  <Input
                    placeholder="KHATAV"
                    maxLength={6}
                    value={config.smsConfig.senderId}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        smsConfig: { ...config.smsConfig, senderId: e.target.value },
                      })
                    }
                  />
                </div>

                <div className="pt-2 flex justify-end">
                  <Button onClick={handleSaveConfig} disabled={saving} className="gap-2">
                    <Save className="w-4 h-4" /> Save SMS Settings
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* TAB 4: TEMPLATE EDITOR */}
          {activeTab === 'templates' && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base font-semibold">Message Template Editor</CardTitle>
                  <CardDescription>Customize message subjects & text with dynamic placeholders.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Notification Type</Label>
                      <select
                        value={selectedType}
                        onChange={(e) => setSelectedType(e.target.value as any)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="InvoiceSend">Invoice Send</option>
                        <option value="PaymentReminder">Payment Reminder</option>
                        <option value="LowStockAlert">Low Stock Alert</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Target Channel</Label>
                      <select
                        value={templateChannel}
                        onChange={(e) => setTemplateChannel(e.target.value as any)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="email">Email</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="sms">SMS</option>
                      </select>
                    </div>
                  </div>

                  {templateChannel === 'email' && (
                    <div className="space-y-1.5">
                      <Label>Subject Line</Label>
                      <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label>Placeholders (Click to insert)</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {PLACEHOLDERS.map((ph) => (
                        <Badge
                          key={ph}
                          variant="outline"
                          onClick={() => insertPlaceholder(ph)}
                          className="cursor-pointer hover:bg-primary/10 transition-colors"
                        >
                          {ph}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Message Body</Label>
                    <textarea
                      rows={6}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="pt-2 flex justify-end">
                    <Button onClick={handleSaveTemplate} disabled={saving} className="gap-2">
                      <Save className="w-4 h-4" /> Save Template
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Live Preview Card */}
              <Card className="bg-muted/20">
                <CardHeader>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Eye className="w-4 h-4 text-primary" /> Live Preview
                  </CardTitle>
                  <CardDescription>Sample rendered output sent to customer</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {templateChannel === 'email' && (
                    <div className="text-sm">
                      <span className="font-semibold text-muted-foreground">Subject: </span>
                      <span className="font-medium text-foreground">{subject}</span>
                    </div>
                  )}

                  <div className="rounded-lg border bg-card p-4 text-sm font-mono whitespace-pre-wrap leading-relaxed shadow-xs">
                    {previewBody}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
