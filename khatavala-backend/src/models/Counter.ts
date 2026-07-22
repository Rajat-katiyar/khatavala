import { Schema, model, InferSchemaType } from 'mongoose';

/**
 * Atomic document numbering, one counter per (company, series).
 *
 * WHY NOT count() + 1
 * -------------------
 * `SalesInvoice.countDocuments() + 1` is the obvious approach and it is wrong
 * under any concurrency at all: two invoices raised in the same second both
 * count 41 and both become INV-42. It is also wrong after a cancellation, since
 * the count drops but the numbers already issued do not.
 *
 * `findOneAndUpdate` with `$inc` and `upsert` hands each caller a distinct
 * number in one atomic server-side operation, which is the only way to get this
 * right without a lock.
 *
 * WHY THE ALLOCATION RUNS INSIDE THE INVOICE TRANSACTION
 * -----------------------------------------------------
 * Allocating outside it would be faster — the counter would never be part of a
 * write conflict. But a transaction that later aborts (out of stock, say) would
 * have consumed a number, leaving a permanent gap in the invoice series. Indian
 * GST requires invoice numbers to be a consecutive serial, so a gap is a
 * compliance problem, not a cosmetic one. Inside the transaction the `$inc`
 * rolls back with everything else.
 *
 * The cost is that concurrent invoices for one company serialise on this
 * document and the losers retry. That is the correct trade: numbering is
 * inherently a serial operation, and `withTransaction` retries write conflicts
 * automatically.
 */

const counterSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },

    /** The series being numbered, e.g. 'SalesInvoice', 'Quotation'. */
    key: { type: String, required: true, trim: true },

    /**
     * Counters reset each financial year — Indian invoice series conventionally
     * restart at 1 every FY and carry the year in the number. Part of the key
     * so last year's counter is preserved rather than overwritten.
     */
    period: { type: String, required: true, trim: true },

    sequence: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

counterSchema.index({ companyId: 1, key: 1, period: 1 }, { unique: true });

export type Counter = InferSchemaType<typeof counterSchema>;
export const CounterModel = model('Counter', counterSchema);
