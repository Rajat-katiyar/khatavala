import { useState, useEffect } from 'react';
import {
  Megaphone,
  Plus,
  Send,
  BarChart2,
  Trash2,
  Loader2,
  Users,
  Clock,
  CheckCircle2,
  XCircle,
  X,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/services/api';

const STATUS_CONFIG: Record<string, { color: string; icon: any }> = {
  Draft: { color: 'bg-gray-100 text-gray-600', icon: Clock },
  Scheduled: { color: 'bg-blue-100 text-blue-700', icon: Clock },
  Sending: { color: 'bg-amber-100 text-amber-700', icon: Loader2 },
  Sent: { color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2 },
  Failed: { color: 'bg-red-100 text-red-700', icon: XCircle },
  Cancelled: { color: 'bg-gray-100 text-gray-500', icon: XCircle },
};

const SEGMENT_LABELS: Record<string, string> = {
  AllCustomers: '🌐 All Customers',
  ByTag: '🏷️ By Tag',
  ByOutstanding: '💸 By Outstanding Balance',
};

interface Campaign {
  _id: string;
  name: string;
  channel: string;
  targetSegment: string;
  messageTemplate: string;
  scheduledAt: string;
  status: string;
  totalRecipients: number;
  sentCount: number;
  failedCount: number;
}

interface DeliveryLog {
  _id: string;
  recipient: string;
  status: string;
  createdAt: string;
}

export function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [reportLogs, setReportLogs] = useState<DeliveryLog[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    channel: 'WhatsApp',
    targetSegment: 'AllCustomers',
    targetTag: '',
    minOutstanding: '',
    messageTemplate: 'Dear {{customerName}}, ',
    scheduledAt: new Date().toISOString().slice(0, 16),
  });

  const fetchCampaigns = () => {
    setLoading(true);
    api.get('/campaigns')
      .then((res) => setCampaigns(res.data.data || []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCampaigns(); }, []);

  const handleCreate = async () => {
    await api.post('/campaigns', form);
    setShowForm(false);
    fetchCampaigns();
  };

  const handleSend = async (id: string) => {
    setSending(id);
    try {
      await api.post(`/campaigns/${id}/send`);
      fetchCampaigns();
    } finally {
      setSending(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this campaign?')) return;
    await api.delete(`/campaigns/${id}`);
    fetchCampaigns();
  };

  const handleViewReport = async (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setReportLoading(true);
    try {
      const res = await api.get(`/campaigns/${campaign._id}/report`);
      setReportLogs(res.data.data.logs || []);
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-primary" />
            WhatsApp Marketing Campaigns
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Send promotional messages to targeted customer segments.</p>
        </div>
        <Button onClick={() => setShowForm(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Campaign
        </Button>
      </div>

      {/* Campaign list */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Megaphone className="w-12 h-12 text-muted-foreground/30" />
            <p className="font-medium text-muted-foreground">No campaigns yet</p>
            <p className="text-xs text-muted-foreground">Create a campaign to start sending WhatsApp messages to your customers.</p>
            <Button size="sm" onClick={() => setShowForm(true)} className="mt-2 gap-2">
              <Plus className="w-3.5 h-3.5" /> Create Campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {campaigns.map((campaign) => {
            const statusCfg = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.Draft;
            const StatusIcon = statusCfg.icon;
            return (
              <Card key={campaign._id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-4 pb-4">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base">{campaign.name}</h3>
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.color}`}>
                          <StatusIcon className="w-3 h-3" />
                          {campaign.status}
                        </span>
                        <span className="text-xs bg-muted px-2 py-0.5 rounded-full">{campaign.channel}</span>
                      </div>
                      <div className="mt-1.5 text-xs text-muted-foreground flex flex-wrap gap-3">
                        <span className="flex items-center gap-1"><Users className="w-3 h-3" />{SEGMENT_LABELS[campaign.targetSegment]}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(campaign.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        {campaign.status === 'Sent' && (
                          <>
                            <span className="text-emerald-600">✅ {campaign.sentCount} sent</span>
                            {campaign.failedCount > 0 && <span className="text-red-500">❌ {campaign.failedCount} failed</span>}
                          </>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground italic line-clamp-2 bg-muted/30 rounded p-2">
                        "{campaign.messageTemplate}"
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {campaign.status === 'Sent' && (
                        <Button variant="outline" size="sm" onClick={() => handleViewReport(campaign)} className="gap-1.5 text-xs">
                          <BarChart2 className="w-3.5 h-3.5" />
                          Report
                        </Button>
                      )}
                      {(campaign.status === 'Draft' || campaign.status === 'Scheduled') && (
                        <Button
                          size="sm"
                          onClick={() => handleSend(campaign._id)}
                          disabled={sending === campaign._id}
                          className="gap-1.5 text-xs"
                        >
                          {sending === campaign._id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Send className="w-3.5 h-3.5" />
                          }
                          Send Now
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(campaign._id)} className="text-destructive hover:text-destructive/80 text-xs gap-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Campaign Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg shadow-2xl">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">New Campaign</CardTitle>
                <button onClick={() => setShowForm(false)} className="p-1.5 rounded-full hover:bg-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Campaign Name</Label>
                <Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Diwali Offer 2025" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Channel</Label>
                  <select
                    value={form.channel}
                    onChange={(e) => setForm(p => ({ ...p, channel: e.target.value }))}
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  >
                    <option>WhatsApp</option>
                    <option>SMS</option>
                    <option>Email</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Target Segment</Label>
                  <select
                    value={form.targetSegment}
                    onChange={(e) => setForm(p => ({ ...p, targetSegment: e.target.value }))}
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  >
                    <option value="AllCustomers">All Customers</option>
                    <option value="ByTag">By Tag</option>
                    <option value="ByOutstanding">By Outstanding</option>
                  </select>
                </div>
              </div>
              {form.targetSegment === 'ByTag' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Customer Tag</Label>
                  <Input value={form.targetTag} onChange={(e) => setForm(p => ({ ...p, targetTag: e.target.value }))} placeholder="e.g. wholesale, vip" />
                </div>
              )}
              {form.targetSegment === 'ByOutstanding' && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Minimum Outstanding Amount (₹)</Label>
                  <Input type="number" value={form.minOutstanding} onChange={(e) => setForm(p => ({ ...p, minOutstanding: e.target.value }))} placeholder="500" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Message Template</Label>
                <textarea
                  value={form.messageTemplate}
                  onChange={(e) => setForm(p => ({ ...p, messageTemplate: e.target.value }))}
                  rows={4}
                  className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary bg-background"
                  placeholder="Dear {{customerName}}, ..."
                />
                <p className="text-xs text-muted-foreground">Use {'{{customerName}}'} and {'{{companyName}}'} as placeholders.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Schedule Date & Time</Label>
                <Input type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm(p => ({ ...p, scheduledAt: e.target.value }))} />
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button className="flex-1 gap-2" onClick={handleCreate} disabled={!form.name || !form.messageTemplate}>
                  <Plus className="w-4 h-4" /> Create Campaign
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delivery Report Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <Card className="w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
            <CardHeader className="pb-3 shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Delivery Report</CardTitle>
                  <CardDescription className="text-xs">{selectedCampaign.name}</CardDescription>
                </div>
                <button onClick={() => setSelectedCampaign(null)} className="p-1.5 rounded-full hover:bg-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </CardHeader>
            <CardContent className="overflow-y-auto flex-1">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Total', value: selectedCampaign.totalRecipients, color: 'text-foreground' },
                  { label: 'Delivered', value: selectedCampaign.sentCount, color: 'text-emerald-600' },
                  { label: 'Failed', value: selectedCampaign.failedCount, color: 'text-red-500' },
                ].map((s) => (
                  <div key={s.label} className="text-center p-3 rounded-xl bg-muted/40">
                    <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                ))}
              </div>
              {reportLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 text-muted-foreground">Recipient</th>
                      <th className="text-left py-2 text-muted-foreground">Status</th>
                      <th className="text-left py-2 text-muted-foreground">Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportLogs.map((log) => (
                      <tr key={log._id} className="border-b hover:bg-muted/20">
                        <td className="py-2 font-mono">{log.recipient}</td>
                        <td className="py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            log.status.toLowerCase() === 'sent' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                          }`}>{log.status}</span>
                        </td>
                        <td className="py-2 text-muted-foreground">{new Date(log.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
