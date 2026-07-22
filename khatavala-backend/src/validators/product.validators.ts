import { z } from 'zod';
import { SYMBOLOGIES } from '../services/barcode.service.js';

const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id');

// `.or(z.literal(''))` throughout: a form that clears a field posts an empty
// string, and rejecting that would make the field unclearable once set.
const optionalId = objectId.or(z.literal('')).nullable().optional();

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(64),
  barcode: z.string().trim().max(64).or(z.literal('')).nullable().optional(),
  categoryId: optionalId,
  brandId: optionalId,
  hsnCode: z.string().trim().max(12).or(z.literal('')).nullable().optional(),
  gstPercentage: z.coerce.number().min(0).max(100).optional(),
  primaryUnitId: objectId,
  secondaryUnitId: optionalId,
  conversionFactor: z.coerce.number().positive().nullable().optional(),
  purchasePrice: z.coerce.number().min(0).optional(),
  sellingPrice: z.coerce.number().min(0).optional(),
  mrp: z.coerce.number().min(0).optional(),
  wholesalePrice: z.coerce.number().min(0).optional(),
  openingStock: z.coerce.number().optional(),
  minStockLevel: z.coerce.number().min(0).optional(),
  maxStockLevel: z.coerce.number().min(0).optional(),
  trackBatch: z.coerce.boolean().optional(),
  trackExpiry: z.coerce.boolean().optional(),
  trackSerial: z.coerce.boolean().optional(),
  imageUrl: z.string().trim().max(500).or(z.literal('')).nullable().optional(),
  isActive: z.coerce.boolean().optional(),
});

/**
 * Update omits `openingStock` entirely — it is stock history, and the
 * Inventory module owns movements from creation onward. `currentStock` is
 * likewise never accepted from a client; changing stock means recording a
 * movement, not editing a number.
 */
export const updateProductSchema = createProductSchema.omit({ openingStock: true }).partial();

export const listProductsQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  categoryId: objectId.optional(),
  brandId: objectId.optional(),
  stockStatus: z.enum(['all', 'low', 'out', 'in']).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sortBy: z
    .enum(['name', 'sku', 'sellingPrice', 'purchasePrice', 'currentStock', 'createdAt'])
    .optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/* ------------------------------- masters -------------------------------- */

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).or(z.literal('')).optional(),
  parentId: optionalId,
  isActive: z.coerce.boolean().optional(),
});

export const brandSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).or(z.literal('')).optional(),
  isActive: z.coerce.boolean().optional(),
});

export const unitSchema = z.object({
  name: z.string().trim().min(1).max(60),
  symbol: z.string().trim().min(1).max(12),
  allowsDecimal: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
});

/* ------------------------------- barcodes ------------------------------- */

export const barcodeQuerySchema = z.object({
  symbology: z.enum(SYMBOLOGIES).optional(),
  scale: z.coerce.number().int().min(1).max(8).optional(),
  height: z.coerce.number().int().min(4).max(50).optional(),
  includeText: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const barcodeSheetSchema = z.object({
  items: z
    .array(
      z.object({
        productId: objectId,
        quantity: z.coerce.number().int().min(1).max(500).optional(),
      })
    )
    .min(1, 'Select at least one product')
    .max(200, 'Select at most 200 products per sheet'),
  symbology: z.enum(SYMBOLOGIES).optional(),
  columns: z.coerce.number().int().min(1).max(5).optional(),
  showPrice: z.coerce.boolean().optional(),
  showName: z.coerce.boolean().optional(),
});
