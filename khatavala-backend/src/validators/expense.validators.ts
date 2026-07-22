import { z } from '../docs/zodOpenapi.js';
import { PAYMENT_MODES } from '../services/payment.factory.js';
import { RECURRENCE_FREQUENCIES } from '../models/Expense.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

/* ------------------------------------------------------------------ *
 * Category validators
 * ------------------------------------------------------------------ */

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
});

/* ------------------------------------------------------------------ *
 * Expense validators
 * ------------------------------------------------------------------ */

export const createExpenseSchema = z.object({
  categoryId: objectId,
  amount: z.number().positive().finite(),
  date: z.string().datetime().optional(),
  paymentMode: z.enum(PAYMENT_MODES),
  description: z.string().trim().max(500).optional(),
  referenceNumber: z.string().trim().max(100).optional(),
  isRecurring: z.boolean().optional(),
  recurrenceFrequency: z.enum(RECURRENCE_FREQUENCIES).optional(),
}).refine(
  (d) => !d.isRecurring || d.recurrenceFrequency != null,
  { message: 'recurrenceFrequency is required when isRecurring is true', path: ['recurrenceFrequency'] }
);

export const listExpensesSchema = z.object({
  categoryId: objectId.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  isRecurring: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  status: z.enum(['Draft', 'Posted']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export const expenseSummarySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
