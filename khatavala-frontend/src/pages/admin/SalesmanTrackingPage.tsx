import { useEffect, useState } from 'react';
import { MapPin, Battery, RefreshCw, Radio, User, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/utils';
import { api } from '@/services/api';

interface SalesmanLocationInfo {
  userId: string;
  name: string;
  email: string;
  role: string;
  latitude: number;
  longitude: number;
  batteryLevel: number;
  lastPingAt: string;
}

export function SalesmanTrackingPage() {
  const [salesmen, setSalesmen] = useState<SalesmanLocationInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const loadLocations = async () => {
    setLoading(true);
    try {
      const { data } = await api.get<{ success: boolean; data: SalesmanLocationInfo[] }>('/salesman/live-locations');
      setSalesmen(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLocations();
  }, []);

  const handleSimulatePing = async () => {
    setSimulating(true);
    setMessage(null);
    try {
      // Simulate GPS move ping in Delhi NCR area
      const lat = 28.6139 + (Math.random() - 0.5) * 0.08;
      const lng = 77.209 + (Math.random() - 0.5) * 0.08;
      const battery = Math.floor(70 + Math.random() * 25);

      await api.post('/salesman/location-ping', {
        latitude: lat,
        longitude: lng,
        batteryLevel: battery,
      });

      setMessage('GPS location ping transmitted successfully!');
      await loadLocations();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Ping failed');
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center gap-2">
            <MapPin className="w-6 h-6 text-primary" /> Salesman Field GPS Tracking
          </h1>
          <p className="text-sm text-muted-foreground">
            Real-time live map tracking of field sales representatives and location pings.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleSimulatePing} disabled={simulating} className="gap-2 text-xs">
            <Radio className="w-3.5 h-3.5 text-rose-500 animate-pulse" /> Simulate GPS Ping
          </Button>

          <Button variant="outline" size="sm" onClick={loadLocations} disabled={loading} className="gap-2 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
      </div>

      {message && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>{message}</span>
        </div>
      )}

      {/* Interactive Map Visualizer */}
      <Card className="overflow-hidden border-primary/20">
        <CardHeader className="pb-3 bg-muted/20 border-b">
          <CardTitle className="text-sm font-semibold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-emerald-500" /> Live Field Map Grid
            </span>
            <Badge variant="outline" className="text-xs">
              {salesmen.length} Field Reps Active
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="h-80 w-full bg-slate-950 rounded-xl border relative overflow-hidden flex items-center justify-center p-4">
            {/* Visual Grid Lines */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)]" />

            {/* Salesman Location Marker Pins */}
            {salesmen.map((sm, i) => (
              <div
                key={sm.userId}
                className="absolute transition-all duration-500 flex flex-col items-center group cursor-pointer z-10"
                style={{
                  top: `${30 + (i * 25) % 50}%`,
                  left: `${25 + (i * 30) % 60}%`,
                }}
              >
                <div className="p-2 rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-primary/20 animate-bounce">
                  <MapPin className="w-4 h-4" />
                </div>
                <div className="mt-1 bg-slate-900/90 text-white text-[11px] font-semibold px-2 py-0.5 rounded border border-slate-700 shadow-xs whitespace-nowrap flex items-center gap-1">
                  <span>{sm.name}</span>
                  <span className="text-[10px] text-emerald-400">({sm.batteryLevel}%)</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Salesman Status Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Field Sales Force List</CardTitle>
          <CardDescription>Real-time location pings, battery levels, and last active timestamps.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Salesman Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>GPS Coordinates</TableHead>
                <TableHead>Battery Level</TableHead>
                <TableHead className="text-right">Last Pinged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Locating field representatives…
                  </TableCell>
                </TableRow>
              ) : salesmen.length > 0 ? (
                salesmen.map((sm) => (
                  <TableRow key={sm.userId}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-full bg-primary/10 text-primary">
                          <User className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <span className="font-semibold text-xs">{sm.name}</span>
                          <p className="text-[11px] text-muted-foreground">{sm.email}</p>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {sm.role}
                      </Badge>
                    </TableCell>

                    <TableCell className="font-mono text-xs">
                      {sm.latitude.toFixed(4)}, {sm.longitude.toFixed(4)}
                    </TableCell>

                    <TableCell className="text-xs font-semibold text-emerald-600">
                      <span className="flex items-center gap-1">
                        <Battery className="w-3.5 h-3.5" /> {sm.batteryLevel}%
                      </span>
                    </TableCell>

                    <TableCell className="text-right text-xs">
                      {formatDate(sm.lastPingAt)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No active salesman location pings recorded.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
