import { z } from '../docs/zodOpenapi.js';

/**
 * GST VALIDATORS — Phase 14
 *
 * Period input: either a month+year pair (for GSTR monthly returns) or a
 * free-form from/to range. Both forms are accepted everywhere.
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
    return parsed;
  });

export const periodQuerySchema = z
  .object({
    month: z.coerce.number().int().min(1).max(12).optional(),
    year: z.coerce.number().int().min(2000).max(2100).optional(),
    from: localDay('start').optional(),
    to: localDay('end').optional(),
  })
  .refine(
    (v) =>
      (v.month !== undefined && v.year !== undefined) ||
      v.from !== undefined ||
      v.to !== undefined ||
      // All empty = all time, valid.
      true,
    { message: 'Provide month+year or a from/to date range' }
  );

/** HSN summary uses the same period query. */
export const hsnSummaryQuerySchema = periodQuerySchema;

/** GSTR-1 uses month+year or date range. */
export const gstr1QuerySchema = periodQuerySchema;

/** GSTR-3B uses the same. */
export const gstr3bQuerySchema = periodQuerySchema;

/** Liability widget — same. */
export const gstLiabilityQuerySchema = periodQuerySchema;

/** Create/update a GSTRate entry. */
export const createGSTRateSchema = z.object({
  hsnCode: z.string().trim().min(1).max(20),
  description: z.string().trim().max(300).optional().default(''),
  cgstPercent: z.number().min(0).max(100),
  sgstPercent: z.number().min(0).max(100),
  igstPercent: z.number().min(0).max(100),
  cessPercent: z.number().min(0).max(100).optional().default(0),
});

export const updateGSTRateSchema = z.object({
  description: z.string().trim().max(300).optional(),
  cgstPercent: z.number().min(0).max(100).optional(),
  sgstPercent: z.number().min(0).max(100).optional(),
  igstPercent: z.number().min(0).max(100).optional(),
  cessPercent: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
});
