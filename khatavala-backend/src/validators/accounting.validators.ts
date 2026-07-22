import { z } from 'zod';
import { ACCOUNT_TYPES } from '../models/Account.js';
import { JOURNAL_SOURCE_TYPES } from '../models/JournalEntry.js';

const objectId = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, 'Not a valid id');

const amount = z.coerce.number().min(0).max(1_000_000_000);

export const createAccountSchema = z.object({
  accountName: z.string().trim().min(1).max(120),
  accountType: z.enum(ACCOUNT_TYPES),
  code: z.string().trim().max(20).nullable().optional(),
  parentAccountId: objectId.nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().optional(),
});

/**
 * `systemKey` and `isSystem` are absent by design — they are the machine-facing
 * identity the posting service resolves accounts by, and a client that could
 * set them could redirect every sales posting into an account of its choosing.
 */
export const updateAccountSchema = createAccountSchema.partial();

/**
 * A manual journal's lines.
 *
 * Both columns are accepted and the service rejects a line carrying both or
 * neither — the UI needs to be able to send an explicit zero for the unused
 * side without that meaning something different from omitting it.
 */
const journalLineSchema = z.object({
  accountId: objectId,
  debitAmount: amount.optional(),
  creditAmount: amount.optional(),
  description: z.string().trim().max(240).nullable().optional(),
});

export const createJournalEntrySchema = z.object({
  date: z.coerce.date().optional(),
  narration: z.string().trim().max(500).nullable().optional(),
  // Two lines minimum: one line cannot balance, by definition. The service
  // checks the amounts; this only checks the shape.
  lines: z.array(journalLineSchema).min(2, 'A journal entry needs at least two lines'),
});

export const createContraEntrySchema = z.object({
  fromAccountId: objectId,
  toAccountId: objectId,
  amount: z.coerce.number().positive('Amount must be positive').max(1_000_000_000),
  date: z.coerce.date().optional(),
  narration: z.string().trim().max(500).nullable().optional(),
});

export const ledgerQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const journalListQuerySchema = ledgerQuerySchema.extend({
  sourceType: z.enum(JOURNAL_SOURCE_TYPES).optional(),
  accountId: objectId.optional(),
});

export const accountListQuerySchema = z.object({
  type: z.enum(ACCOUNT_TYPES).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const trialBalanceQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
