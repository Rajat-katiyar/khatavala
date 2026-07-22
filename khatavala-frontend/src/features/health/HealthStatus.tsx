import { useHealth } from '@/hooks/useHealth';

export function HealthStatus() {
  const { data, error, loading } = useHealth();

  if (loading) return <p className="text-muted-foreground">Pinging API…</p>;
  if (error)
    return <p className="text-red-500">API unreachable: {error}</p>;

  return (
    <div className="rounded-lg border p-4 space-y-1">
      <p className="font-medium text-green-600">API status: {data?.status}</p>
      <p className="text-sm text-muted-foreground">
        Mongo: {data?.services.mongo} · Redis: {data?.services.redis}
      </p>
      <p className="text-sm text-muted-foreground">
        Uptime: {data?.uptime.toFixed(0)}s
      </p>
    </div>
  );
}
