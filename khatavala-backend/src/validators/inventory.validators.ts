import { z } from 'zod';
import { MOVEMENT_TYPES } from '../models/StockLedgerEntry.js';

const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id');

const addressSchema = z.object({
  line1: z.string().trim().max(160).optional(),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  pincode: z.string().trim().max(12).optional(),
});

/** Optional batch. An empty string from a cleared form means "no batch", not "". */
const batchNumber = z
  .string()
  .trim()
  .max(64)
  .transform((v) => (v.length > 0 ? v : null))
  .nullable()
  .optional();

const expiryDate = z.coerce.date().nullable().optional();

/* --------------------------- Warehouses --------------------------- */

export const createWarehouseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: addressSchema.optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const updateWarehouseSchema = createWarehouseSchema.partial();

/* ---------------------------- Movements --------------------------- */

/**
 * Quantities are capped rather than merely positive. A typo'd 999999999 in a
 * stock count is not a movement anyone meant to make, and letting it through
 * means an adjustment to undo it and two wrong rows in the audit trail forever.
 */
const quantity = (min: number) =>
  z.coerce
    .number()
    .refine((v) => Number.isFinite(v), 'Quantity must be a number')
    .refine((v) => v >= min, `Quantity must be at least ${min}`)
    .refine((v) => Math.abs(v) <= 1_000_000, 'Quantity looks unreasonably large');

export const openingStockSchema = z.object({
  productId: objectId,
  warehouseId: objectId,
  quantity: quantity(0.0001),
  batchNumber,
  expiryDate,
  timestamp: z.coerce.date().optional(),
});

export const transferSchema = z.object({
  productId: objectId,
  fromWarehouseId: objectId,
  toWarehouseId: objectId,
  quantity: quantity(0.0001),
  batchNumber,
  expiryDate,
  reason: z.string().trim().max(240).optional(),
  timestamp: z.coerce.date().optional(),
});

/**
 * An adjustment's quantity is SIGNED — positive writes stock on, negative
 * writes it off — and zero is rejected, since a movement that changes nothing
 * is a row of noise in the ledger.
 */
export const adjustmentSchema = z.object({
  productId: objectId,
  warehouseId: objectId,
  quantity: quantity(-1_000_000).refine((v) => v !== 0, 'Adjustment cannot be zero'),
  reason: z.string().trim().min(3, 'Give a reason for the adjustment').max(240),
  batchNumber,
  expiryDate,
  timestamp: z.coerce.date().optional(),
});

/** Damage is always a write-off, so the quantity is a positive magnitude. */
export const damageSchema = z.object({
  productId: objectId,
  warehouseId: objectId,
  quantity: quantity(0.0001),
  reason: z.string().trim().min(3, 'Give a reason for the write-off').max(240),
  batchNumber,
  expiryDate,
  timestamp: z.coerce.date().optional(),
});

/* ------------------------------ Reads ----------------------------- */

const boolFlag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const currentStockQuerySchema = z.object({
  productId: objectId.optional(),
  warehouseId: objectId.optional(),
  search: z.string().trim().max(120).optional(),
  lowOnly: boolFlag,
  includeZero: boolFlag,
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const movementHistoryQuerySchema = z.object({
  productId: objectId.optional(),
  warehouseId: objectId.optional(),
  movementType: z.enum(MOVEMENT_TYPES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
