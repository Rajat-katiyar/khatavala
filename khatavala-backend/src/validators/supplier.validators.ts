import { z } from 'zod';

// Indian formats — GSTIN is 15 chars, PAN is 10. Both optional: a small
// unregistered supplier has neither.
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const addressSchema = z.object({
  line1: z.string().trim().max(160).optional(),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().max(12).optional(),
});

// `.or(z.literal(''))` on the optional identifiers: a form that clears a field
// posts an empty string, and rejecting that would make GST unclearable once set.
const optionalUpper = (regex: RegExp, message: string) =>
  z.string().trim().toUpperCase().regex(regex, message).or(z.literal('')).optional();

export const createSupplierSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9]{7,15}$/, 'Phone must be 7–15 digits'),
  email: z.string().trim().toLowerCase().email().or(z.literal('')).optional(),
  gstNumber: optionalUpper(GST_RE, 'Not a valid 15-character GSTIN'),
  pan: optionalUpper(PAN_RE, 'Not a valid PAN'),
  address: addressSchema.optional(),
  openingBalance: z.coerce.number().optional(),
  // Nullable, not just optional: clearing a rating in the UI posts null.
  vendorRating: z.coerce.number().int().min(1).max(5).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * Update omits `openingBalance` entirely — it is materialised as the first
 * ledger entry at creation, so changing it later would leave the ledger and
 * `currentBalance` disagreeing. Correct one with an adjustment entry.
 * `currentBalance` is likewise ledger-owned and never accepted from a client.
 */
export const updateSupplierSchema = createSupplierSchema.omit({ openingBalance: true }).partial();

export const listSuppliersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  sortBy: z.enum(['name', 'phone', 'currentBalance', 'vendorRating', 'createdAt']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  hasDues: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
});

export const ledgerQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
