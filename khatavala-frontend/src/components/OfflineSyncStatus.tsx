import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Wifi, WifiOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { offlineDb } from '@/db/db';
import * as syncService from '@/services/sync.service';

export function OfflineSyncStatus() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);

  // Live query for pending offline transactions in Dexie.js
  const pendingTransactions = useLiveQuery(
    () => offlineDb.pendingTransactions.toArray(),
    []
  );

  const pendingCount = pendingTransactions?.length || 0;

  const triggerSync = async () => {
    if (syncing || !isOnline || pendingCount === 0) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await syncService.syncPendingTransactions();
      if (res.syncedCount > 0) {
        setSyncResult(`Successfully synced ${res.syncedCount} offline bill(s)!`);
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      void triggerSync();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Initial catalog caching when online
    if (isOnline) {
      void syncService.cacheCatalogLocally();
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isOnline]);

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Network Online / Offline Status Badge */}
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border bg-card shadow-2xs font-medium">
        {isOnline ? (
          <>
            <Wifi className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Online</span>
          </>
        ) : (
          <>
            <WifiOff className="w-3.5 h-3.5 text-rose-500" />
            <span className="text-rose-600 dark:text-rose-400 font-bold uppercase tracking-wider">Offline Mode</span>
          </>
        )}
      </div>

      {/* Pending Sync Counter Badge & Trigger Button */}
      {pendingCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={triggerSync}
          disabled={syncing || !isOnline}
          className="h-7 text-xs gap-1.5 border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span className="font-bold">{pendingCount}</span> Bill(s) Pending Sync
        </Button>
      )}

      {syncResult && (
        <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
          <CheckCircle2 className="w-3.5 h-3.5" /> {syncResult}
        </span>
      )}
    </div>
  );
}
