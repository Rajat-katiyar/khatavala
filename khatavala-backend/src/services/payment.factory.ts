import mongoose, { Types, type ClientSession, type Model } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { nextDocumentNumber, type NumberingConfig } from './numbering.service.js';
import { round2 } from './tradeDocument.factory.js';
import {
  tenantById,
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';
import type { AppendEntryOptions } from './ledger.factory.js';

/**
 * SHARED PAYMENT ENGINE
 * =====================
 * Money received from a customer and money paid to a supplier are the same
 * machinery: a document, a roll-up on the bill, and a ledger entry, all moved
 * together in one transaction. They differ in exactly two things:
 *
 *   1. WHICH COLUMN the ledger entry lands in.
 *        Customer (debtor):  a receipt CREDITS them — they owe us less.
 *        Supplier (creditor): a payment DEBITS them — we owe them less.
 *      Getting this backwards would make every payables report read inverted,
 *      so the direction is a required parameter rather than something each
 *      caller remembers. Same reasoning as ledger.factory.ts.
 *
 *   2. Which collections the payment and the bill live in.
 *
 * Everything else — the overpayment guard, the status transitions, the refund
 * discipline, the cash-up rollup — lives here once. Phase 10 wrote it for the
 * selling side; Phase 11 lifted it rather than copying it, because a second
 * hand-maintained copy of the refund rule is exactly the thing that drifts.
 */

export const PAYMENT_MODES = ['Cash', 'UPI', 'Card', 'Bank', 'Cheque'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Which ledger column a payment lands in for this party. */
export type PaymentDirection = 'debit' | 'credit';

export interface PaymentEngineConfig {
  /** The payment collection. */
  paymentModel: Model<any>;
  /** The bill collection this payment settles. */
  billModel: Model<any>;
  /** Field on the payment pointing at the bill, e.g. 'invoiceId'. */
  billField: string;
  /** Field on the payment pointing at the party, e.g. 'customerId'. */
  partyField: string;
  /** Human label for errors, e.g. 'Invoice' / 'Purchase invoice'. */
  billLabel: string;
  numbering: NumberingConfig;
  /** Statuses in which the bill has been posted and can take money. */
  postedStatuses: readonly string[];
  /** See the header — this is the load-bearing parameter. */
  direction: PaymentDirection;
  /** `referenceModel` written onto the ledger entry. */
  ledgerReferenceModel: string;
  /** The party ledger's appendEntry, already bound to its own collection. */
  appendLedgerEntry: (
    tenant: TenantContext,
    input: Record<string, unknown>,
    options?: AppendEntryOptions
  ) => Promise<any>;
  /** Key the ledger's appendEntry expects for the party, e.g. 'customerId'. */
  ledgerPartyKey: string;
  /**
   * Posts the double-entry journal for this payment, in the same transaction.
   *
   * Passed in rather than resolved here because the two sides post opposite
   * entries — a receipt debits cash and credits receivables; a supplier payment
   * debits payables and credits cash. See journal.service.
   */
  postJournal: (
    tenant: TenantContext,
    payment: any,
    bill: any,
    session: ClientSession,
    options: { isRefund?: boolean }
  ) => Promise<unknown>;
}

export interface RecordPaymentInput {
  amount: number;
  mode: PaymentMode;
  date?: Date;
  referenceNumber?: string | null;
  notes?: string | null;
}

export function createPaymentEngine(config: PaymentEngineConfig) {
  const {
    paymentModel,
    billModel,
    billField,
    partyField,
    billLabel,
    numbering,
    postedStatuses,
    direction,
    ledgerReferenceModel,
    appendLedgerEntry,
    ledgerPartyKey,
    postJournal,
  } = config;

  /**
   * Applies a payment to an already-loaded bill inside an open transaction.
   *
   * Split out so a caller holding the document — POS creating and paying an
   * invoice in one act — can use it without a pointless re-read.
   */
  async function applyPayment(
    tenant: TenantContext,
    bill: any,
    input: RecordPaymentInput,
    session: ClientSession,
    extra: Record<string, unknown> = {}
  ) {
    if (!(input.amount > 0)) throw ApiError.badRequest('Payment amount must be positive');

    if (!postedStatuses.includes(bill.status)) {
      throw ApiError.badRequest(
        `Cannot take payment against a ${String(bill.status).toLowerCase()} ${billLabel.toLowerCase()}`
      );
    }

    const outstanding = round2(bill.grandTotal - bill.amountPaid);
    if (input.amount > outstanding + 0.005) {
      // Refused rather than absorbed as an advance: an overpayment against one
      // bill needs an allocation model, and quietly recording it here would
      // attach money to a document that did not earn it.
      throw ApiError.badRequest(
        `Payment exceeds the outstanding amount of ${outstanding}`,
        { outstanding }
      );
    }

    const date = input.date ?? new Date();
    const documentNumber = await nextDocumentNumber(tenant, numbering, { session, date });

    const [payment] = await paymentModel.create(
      [
        tenantStamp(tenant, {
          documentNumber,
          [billField]: bill._id,
          [partyField]: bill[partyField],
          amount: round2(input.amount),
          mode: input.mode,
          date,
          referenceNumber: input.referenceNumber?.trim() || null,
          notes: input.notes?.trim() || null,
          receivedBy: tenant.actor?.userId ?? null,
          ...extra,
        }),
      ],
      { session }
    );

    await appendLedgerEntry(
      tenant,
      {
        [ledgerPartyKey]: String(bill[partyField]),
        type: 'Payment',
        // THE direction. See the header.
        [direction]: round2(input.amount),
        referenceModel: ledgerReferenceModel,
        referenceId: payment._id,
        date,
        narration: `${input.mode} payment ${documentNumber} against ${bill.documentNumber}`,
      },
      { session }
    );

    await postJournal(tenant, payment, bill, session, {});

    bill.amountPaid = round2(bill.amountPaid + input.amount);
    // Compared with a tolerance rather than `===`: part-payments summing to the
    // total should close the bill even if the last lands a rounding artefact
    // away from it.
    bill.status =
      Math.abs(bill.grandTotal - bill.amountPaid) < 0.005 ? 'Paid' : 'PartiallyPaid';
    await bill.save({ session });

    return payment;
  }

  /** Records a payment against a bill by id, in its own transaction. */
  async function recordPayment(
    tenant: TenantContext,
    billId: string,
    input: RecordPaymentInput
  ) {
    if (!Types.ObjectId.isValid(billId)) {
      throw ApiError.badRequest(`Not a valid ${billLabel.toLowerCase()} id`);
    }

    const session = await mongoose.startSession();
    try {
      let result: any;
      await session.withTransaction(async () => {
        const bill = await billModel.findOne(tenantById(tenant, billId)).session(session);
        if (!bill) throw ApiError.notFound(`${billLabel} not found`);

        const payment = await applyPayment(tenant, bill, input, session);
        result = { payment: payment.toObject(), bill: bill.toObject() };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Money going back the other way — a refund received from a supplier, or cash
   * handed back to a customer on a return.
   *
   * A NEW row flagged `isReversal`, never an edit. The ledgers are append-only
   * and `amountPaid` was derived from these rows; erasing one would leave both
   * stating a figure with nothing behind it.
   */
  async function refundPayment(
    tenant: TenantContext,
    bill: any,
    input: RecordPaymentInput & Record<string, unknown>,
    session: ClientSession,
    extra: Record<string, unknown> = {}
  ) {
    if (!(input.amount > 0)) throw ApiError.badRequest('Refund amount must be positive');
    if (input.amount > bill.amountPaid + 0.005) {
      throw ApiError.badRequest(
        `Cannot refund ${input.amount} — only ${round2(bill.amountPaid)} was received`
      );
    }

    const date = input.date ?? new Date();
    const documentNumber = await nextDocumentNumber(tenant, numbering, { session, date });

    const [refund] = await paymentModel.create(
      [
        tenantStamp(tenant, {
          documentNumber,
          [billField]: bill._id,
          [partyField]: bill[partyField],
          amount: round2(input.amount),
          mode: input.mode,
          date,
          referenceNumber: input.referenceNumber?.trim() || null,
          notes: input.notes?.trim() || null,
          isReversal: true,
          receivedBy: tenant.actor?.userId ?? null,
          ...extra,
        }),
      ],
      { session }
    );

    /**
     * NO LEDGER ENTRY, deliberately.
     *
     * The credit/debit note behind this refund already moved the party's
     * balance by the full returned value. Settling part of it in cash discharges
     * that note — it does not create a second adjustment. Posting one would move
     * the balance twice for a single return. What DOES have to move is
     * `amountPaid`, because money changed hands.
     *
     * The JOURNAL does move, though — cash physically left the till, and the
     * cash book has to show it. That is a different question from what the
     * party owes, which is why one moves and the other does not.
     */
    await postJournal(tenant, refund, bill, session, { isRefund: true });

    bill.amountPaid = round2(bill.amountPaid - input.amount);
    bill.status =
      bill.amountPaid <= 0.005
        ? 'Unpaid'
        : Math.abs(bill.grandTotal - bill.amountPaid) < 0.005
          ? 'Paid'
          : 'PartiallyPaid';
    await bill.save({ session });

    return refund;
  }

  /** Payment history for one bill, oldest first — how a statement reads. */
  async function getPaymentsForBill(tenant: TenantContext, billId: string) {
    if (!Types.ObjectId.isValid(billId)) {
      throw ApiError.badRequest(`Not a valid ${billLabel.toLowerCase()} id`);
    }

    const bill = (await billModel
      .findOne(tenantById(tenant, billId))
      .select(`documentNumber grandTotal amountPaid status ${partyField.replace('Id', 'Name')}`)
      .lean()) as { grandTotal: number; amountPaid: number } | null;
    if (!bill) throw ApiError.notFound(`${billLabel} not found`);

    const payments = await paymentModel
      .find(tenantFilter(tenant, { [billField]: new Types.ObjectId(billId) }))
      .sort({ date: 1, _id: 1 })
      .lean();

    const received = round2(
      payments.reduce(
        (sum: number, payment: any) =>
          sum + (payment.isReversal ? -payment.amount : payment.amount),
        0
      )
    );

    return {
      bill,
      payments,
      totals: { received, outstanding: round2(bill.grandTotal - bill.amountPaid) },
    };
  }

  /** Cash-up: what moved, by mode, over a period. */
  async function getPaymentSummary(
    tenant: TenantContext,
    query: { from?: Date; to?: Date } = {}
  ) {
    const filter: Record<string, unknown> = {};
    if (query.from || query.to) {
      filter.date = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }

    const rows = await paymentModel.aggregate([
      { $match: tenantFilter(tenant, filter) },
      {
        $group: {
          _id: '$mode',
          // Refunds are stored positive with a flag, so they are netted here
          // rather than in the stored amount — a "total by mode" report must
          // not silently absorb them.
          received: { $sum: { $cond: ['$isReversal', 0, '$amount'] } },
          refunded: { $sum: { $cond: ['$isReversal', '$amount', 0] } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return {
      byMode: rows.map((row) => ({
        mode: row._id,
        received: round2(row.received),
        refunded: round2(row.refunded),
        net: round2(row.received - row.refunded),
        count: row.count,
      })),
      total: round2(rows.reduce((sum, row) => sum + row.received - row.refunded, 0)),
    };
  }

  return { applyPayment, recordPayment, refundPayment, getPaymentsForBill, getPaymentSummary };
}
