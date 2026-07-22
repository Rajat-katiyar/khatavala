import { z } from '../docs/zodOpenapi.js';
import { TRANSACTION_MODES, TRANSACTION_STATUSES } from '../models/BankTransaction.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ObjectId');

/* ------------------------------------------------------------------ *
 * Bank Account validators
 * ------------------------------------------------------------------ */

export const createBankAccountSchema = z.object({
  accountName: z.string().trim().min(1).max(100),
  bankName: z.string().trim().min(1).max(100),
  accountNumber: z.string().trim().min(5).max(30),
  ifscCode: z.string().trim().length(11).optional(),
  branchName: z.string().trim().max(100).optional(),
  openingBalance: z.number().finite().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const updateBankAccountSchema = z.object({
  accountName: z.string().trim().min(1).max(100).optional(),
  bankName: z.string().trim().min(1).max(100).optional(),
  ifscCode: z.string().trim().length(11).optional(),
  branchName: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  isActive: z.boolean().optional(),
});

/* ------------------------------------------------------------------ *
 * Transaction validators
 * ------------------------------------------------------------------ */

export const createTransactionSchema = z.object({
  transactionDate: z.string().datetime(),
  valueDate: z.string().datetime().optional(),
  amount: z.number().positive().finite(),
  type: z.enum(['Credit', 'Debit']),
  mode: z.enum(TRANSACTION_MODES),
  referenceNumber: z.string().trim().max(100).optional(),
  chequeNumber: z.string().trim().max(20).optional(),
  description: z.string().trim().max(500).optional(),
});

export const listTransactionsSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  mode: z.enum(TRANSACTION_MODES).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export const updateTransactionStatusSchema = z.object({
  status: z.enum(TRANSACTION_STATUSES),
});

/* ------------------------------------------------------------------ *
 * Reconciliation validators
 * ------------------------------------------------------------------ */

export const manualMatchSchema = z.object({
  transactionId: objectId,
  statementEntryId: objectId,
});

export const autoReconcileSchema = z.object({
  batch: z.string().optional(),
});

export const getReconciliationSchema = z.object({
  batch: z.string().optional(),
});
