import { z } from 'zod';

// Example module validator (per-module Zod schemas live here).
export const healthQuerySchema = z.object({
  verbose: z.coerce.boolean().optional(),
});

export type HealthQuery = z.infer<typeof healthQuerySchema>;
