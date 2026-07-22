// Imported for the side effect of enabling `.openapi()` — see docs/zodOpenapi.ts.
import { z } from '../docs/zodOpenapi.js';

const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id');

/**
 * DATE-ONLY INPUT IS A LOCAL CALENDAR DAY, NOT A UTC INSTANT.
 *
 * A date picker sends "2026-07-19". `new Date("2026-07-19")` parses that as
 * UTC midnight — so in any timezone east of UTC it is already the 19th locally
 * while the instant belongs to the 18th, and a day filter built from it covers
 * the wrong 24 hours.
 *
 * That is not theoretical: on this IST machine at 00:40 on the 19th, a day book
 * for "today" returned NOTHING, because the window ran to 18:29 UTC and the
 * entries had been posted at 19:10 UTC. The report was empty and gave no hint
 * why.
 *
 * So a `YYYY-MM-DD` string is built from its parts in LOCAL time, which is what
 * the person reading the report means by that date. A full timestamp is left
 * exactly as sent — a caller who specifies an instant has said what they want.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const localDay = (edge: 'start' | 'end') =>
  z.union([z.string(), z.date()]).transform((value, ctx) => {
    if (typeof value === 'string' && DATE_ONLY.test(value)) {
      const [year, month, day] = value.split('-').map(Number);
      return edge === 'start'
        ? new Date(year, month - 1, day, 0, 0, 0, 0)
        : new Date(year, month - 1, day, 23, 59, 59, 999);
    }

    const parsed = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Not a valid date' });
      return z.NEVER;
    }

    // A caller who sends a full timestamp at exactly midnight almost certainly
    // means "that whole day", so the end edge is still pushed forward.
    if (
      edge === 'end' &&
      parsed.getHours() === 0 &&
      parsed.getMinutes() === 0 &&
      parsed.getSeconds() === 0 &&
      parsed.getMilliseconds() === 0
    ) {
      parsed.setHours(23, 59, 59, 999);
    }
    return parsed;
  });

/**
 * `.openapi(...)` describes these for the API reference. Without it the union
 * below generates `anyOf: [string, string]`, which tells a reader nothing about
 * the one format that actually works.
 */
const DATE_DOC = {
  type: 'string' as const,
  format: 'date',
  example: '2026-07-19',
  description: 'Date only, `YYYY-MM-DD`, interpreted in the server’s local time.',
};

const startDate = localDay('start').openapi(DATE_DOC);
const endOfDay = localDay('end').openapi(DATE_DOC);

export const dateRangeSchema = z.object({
  from: startDate.optional(),
  to: endOfDay.optional(),
});

export const asOfSchema = z.object({
  to: endOfDay.optional(),
});

export const dayBookQuerySchema = z.object({
  date: startDate.optional(),
  from: startDate.optional(),
  to: endOfDay.optional(),
});

export const drillDownQuerySchema = z.object({
  accountId: objectId,
  from: startDate.optional(),
  to: endOfDay.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const exportQuerySchema = z.object({
  format: z.enum(['pdf', 'xlsx']).default('pdf'),
  from: startDate.optional(),
  to: endOfDay.optional(),
  date: startDate.optional(),
});
