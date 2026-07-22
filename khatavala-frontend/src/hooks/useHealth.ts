import { useEffect, useState } from 'react';
import { pingHealth } from '@/services/health.service';
import type { HealthData } from '@/types';

export function useHealth() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    pingHealth()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { data, error, loading };
}
