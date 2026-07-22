import { useEffect, useState } from 'react';
import { Mail, MessageSquare, Send, CheckCircle2, AlertCircle, Clock, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import * as notifService from '@/services/notification.service';
import type { NotificationLogItem } from '@/services/notification.service';

export function NotificationHistory() {
  const [logs, setLogs] = useState<NotificationLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const data = await notifService.getNotificationHistory({
        channel: channelFilter || undefined,
        status: statusFilter || undefined,
      });
      setLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchHistory();
  }, [channelFilter, statusFilter]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notification History Log</h1>
          <p className="text-sm text-muted-foreground">
            Audit log of all sent invoice PDFs, payment reminders, and low-stock alerts.
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={fetchHistory} disabled={loading} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Filters Bar */}
      <div className="flex items-center gap-4 flex-wrap bg-card p-3 rounded-lg border shadow-xs text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Channel:</span>
          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="flex h-9 rounded-md border border-input bg-background px-3 text-xs"
          >
            <option value="">All Channels</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="flex h-9 rounded-md border border-input bg-background px-3 text-xs"
          >
            <option value="">All Statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="queued">Queued</option>
          </select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Sent Logs</CardTitle>
          <CardDescription>Real-time delivery status for outbound communications</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Loading notification history…</div>
          ) : logs.length > 0 ? (
            <div className="divide-y rounded-md border">
              {logs.map((log) => (
                <div key={log._id} className="p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between text-sm">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize gap-1 text-xs">
                        {log.channel === 'email' && <Mail className="w-3 h-3 text-blue-500" />}
                        {log.channel === 'whatsapp' && <MessageSquare className="w-3 h-3 text-emerald-500" />}
                        {log.channel === 'sms' && <Send className="w-3 h-3 text-amber-500" />}
                        {log.channel}
                      </Badge>
                      <span className="font-semibold text-foreground">{log.templateType}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Recipient: <span className="font-medium text-foreground">{log.recipient}</span>
                    </p>
                    {log.subject && <p className="text-xs font-medium text-foreground">{log.subject}</p>}
                  </div>

                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-muted-foreground">
                      {new Date(log.sentAt).toLocaleString()}
                    </span>

                    {log.status === 'sent' && (
                      <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Sent
                      </Badge>
                    )}
                    {log.status === 'failed' && (
                      <Badge variant="destructive" className="gap-1 font-semibold" title={log.errorMessage}>
                        <AlertCircle className="w-3 h-3" /> Failed
                      </Badge>
                    )}
                    {log.status === 'queued' && (
                      <Badge variant="secondary" className="gap-1 font-semibold">
                        <Clock className="w-3 h-3" /> Queued
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No notification logs recorded yet.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
