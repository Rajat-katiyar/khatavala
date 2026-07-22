import { Schema } from 'mongoose';

/**
 * THE SHARED SHAPE OF A TRADE DOCUMENT
 * ====================================
 * A quotation, a sales order and an invoice are the same document at three
 * points in its life: same party, same lines, same arithmetic. What differs is
 * the status vocabulary and what happens when they are confirmed — only an
 * invoice moves stock and posts to a ledger.
 *
 * SO IS A PURCHASE ORDER, A GRN AND A PURCHASE BILL. Phase 11 generalised this
 * from "sales document" to "trade document": the buying side has the identical
 * shape with `supplierId` where the selling side has `customerId`, and the
 * direction of the stock movement and the ledger entry reversed. Those two
 * differences live in the services; the shape lives here, once.
 *
 * That is the same call ledger.factory.ts already makes for customers and
 * suppliers, for the same reason: hand-maintained copies drift the first time
 * someone adds a field to one of them.
 *
 * MONEY IS STORED, NOT DERIVED
 * ----------------------------
 * `lineTotal`, `subTotal`, `totalTax` and `grandTotal` are all persisted even
 * though every one of them is computable from the line inputs. That is
 * deliberate: an invoice is a legal record of what was charged, and it must
 * still show the same figures in five years when the product's price, its GST
 * rate and the rounding rules have all moved on. Recomputing on read would
 * silently rewrite history.
 *
 * The service layer recomputes them on every write anyway and never trusts
 * client-supplied totals — see sales.service.ts. Stored, but not trusted.
 *
 * PRODUCT DETAILS ARE SNAPSHOTTED ONTO THE LINE
 * --------------------------------------------
 * `name`, `sku` and `hsnCode` are copied onto the line item rather than being
 * read through `productId` at render time, for the same reason: renaming a
 * product must not retroactively change what an old invoice says was sold.
 * `productId` remains for stock and reporting.
 */

export const lineItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },

    // Snapshot of the product as it was when the document was raised.
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
    hsnCode: { type: String, trim: true, default: null },

    quantity: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },

    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    gstPercent: { type: Number, default: 0, min: 0, max: 100 },

    /**
     * GST component rates and amounts, split at document creation from the
     * combined gstPercent based on the supply type (intra/inter-state).
     *
     * Intra-state: cgst === sgst === gstPercent / 2, igst === 0.
     * Inter-state: igst === gstPercent, cgst === sgst === 0.
     * These are STORED, not derived — see the MONEY IS STORED comment above.
     */
    cgstPercent: { type: Number, default: 0, min: 0 },
    sgstPercent: { type: Number, default: 0, min: 0 },
    igstPercent: { type: Number, default: 0, min: 0 },
    cessPercent: { type: Number, default: 0, min: 0 },

    cgstAmount: { type: Number, default: 0, min: 0 },
    sgstAmount: { type: Number, default: 0, min: 0 },
    igstAmount: { type: Number, default: 0, min: 0 },
    cessAmount: { type: Number, default: 0, min: 0 },

    /**
     * Absolute amounts for this line, all post-discount. Held per line because
     * a GST invoice prints tax per line (rates differ across lines) and the
     * totals must reconcile to the sum of the lines exactly.
     */
    discountAmount: { type: Number, default: 0, min: 0 },
    taxableAmount: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    /** taxableAmount + taxAmount — what this line adds to the grand total. */
    lineTotal: { type: Number, required: true, min: 0 },

    /** Which warehouse this line ships from. Invoices only; see below. */
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },
    batchNumber: { type: String, trim: true, default: null },
    /**
     * Batch expiry, captured at GOODS RECEIPT. This is the moment it is known —
     * the carton is in the clerk's hands — and stock.service carries it onto
     * the balance row from there. Null on documents that move no goods.
     */
    expiryDate: { type: Date, default: null },

    /**
     * On a SalesReturn or CreditNote line: the invoice line this came back
     * from. Null elsewhere.
     *
     * Load-bearing, not decorative. The cap on "how much of this line is still
     * returnable" is computed by summing prior return lines per invoice LINE —
     * and an invoice can carry the same product on two lines at different
     * prices, which `productId` alone cannot tell apart. Without this the cap
     * could be evaded by returning against the cheaper line twice.
     */
    sourceLineItemId: { type: Schema.Types.ObjectId, default: null },

    /**
     * GRN lines only: what the order said versus what was refused.
     *
     * `quantity` on a GRN line is the quantity ACCEPTED — the figure that goes
     * into stock. These two record the discrepancy beside it instead of
     * discarding it, which is the entire reason a receipt is a separate
     * document from the order: a supplier who ships 95 of 100 and 3 damaged is
     * the normal case, not the exception.
     */
    orderedQuantity: { type: Number, default: null },
    rejectedQuantity: { type: Number, default: 0 },
  },
  { _id: true }
);

/**
 * Which party the document is against, and what the chain may point at.
 *
 * Defaults are the SELLING side, so every Phase 9/10 call site keeps working
 * untouched. The buying side passes the supplier variant.
 */
export interface PartyConfig {
  /** Field holding the party id, e.g. 'customerId' / 'supplierId'. */
  field: string;
  /** Model the id references, e.g. 'Customer' / 'Supplier'. */
  ref: string;
  /** Field holding the snapshotted party name. */
  nameField: string;
}

export const CUSTOMER_PARTY: PartyConfig = {
  field: 'customerId',
  ref: 'Customer',
  nameField: 'customerName',
};

export const SUPPLIER_PARTY: PartyConfig = {
  field: 'supplierId',
  ref: 'Supplier',
  nameField: 'supplierName',
};

/** Every model a conversion chain may point at, both trade sides. */
const CHAIN_MODELS = [
  'Quotation',
  'SalesOrder',
  'Invoice',
  'DeliveryChallan',
  'PurchaseOrder',
  'GoodsReceiptNote',
  'PurchaseInvoice',
];

export interface TradeDocumentSchemaOptions {
  /** The status vocabulary for this document type. */
  statuses: readonly string[];
  defaultStatus: string;
  /** Extra fields specific to one document type. */
  extraFields?: Record<string, unknown>;
  /** Defaults to the customer/selling side. */
  party?: PartyConfig;
}

export function createTradeDocumentSchema({
  statuses,
  defaultStatus,
  extraFields = {},
  party = CUSTOMER_PARTY,
}: TradeDocumentSchemaOptions) {
  /**
   * The definition is assembled as a plain object and cast at construction:
   * the party fields are COMPUTED keys, and TypeScript widens a computed key's
   * value to `unknown`, which mongoose's SchemaDefinition rejects. The shape is
   * still checked everywhere it is read.
   */
  const definition: Record<string, unknown> = {
    ...{
      companyId: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true,
      },

      /** Human-facing serial, e.g. INV-2026-27-0042. Unique per company. */
      documentNumber: { type: String, required: true, trim: true },

      [party.field]: {
        type: Schema.Types.ObjectId,
        ref: party.ref,
        required: true,
        index: true,
      },
      /** Snapshotted for the same reason the line details are. */
      [party.nameField]: { type: String, required: true, trim: true },

      date: { type: Date, required: true, default: () => new Date() },
      dueDate: { type: Date, default: null },

      lineItems: {
        type: [lineItemSchema],
        validate: {
          validator: (items: unknown[]) => items.length > 0,
          message: 'A sales document needs at least one line item',
        },
      },

      subTotal: { type: Number, required: true, default: 0 },
      totalDiscount: { type: Number, required: true, default: 0 },
      totalTax: { type: Number, required: true, default: 0 },
      /**
       * Rounding to the nearest rupee, as printed on Indian invoices. Kept as
       * its own field so the grand total reconciles to the lines plus a visible
       * adjustment, rather than appearing to disagree with them by a few paise.
       */
      roundOff: { type: Number, default: 0 },
      grandTotal: { type: Number, required: true, default: 0 },

      status: { type: String, enum: statuses, required: true, default: defaultStatus },

      /**
       * THE CONVERSION CHAIN. Points at the document this one was created from
       * — an order at its quotation, an invoice at its order. Polymorphic via
       * refPath so `.populate('sourceDocumentId')` resolves to the right
       * collection, and traversable in both directions: the source is marked
       * `Converted` and stamped with `convertedToId`.
       */
      sourceDocumentId: {
        type: Schema.Types.ObjectId,
        refPath: 'sourceDocumentModel',
        default: null,
      },
      sourceDocumentModel: {
        type: String,
        enum: CHAIN_MODELS,
        default: null,
      },
      convertedToId: { type: Schema.Types.ObjectId, default: null },
      convertedToModel: {
        type: String,
        enum: CHAIN_MODELS,
        default: null,
      },

      /**
       * Whether this is an intra-state or inter-state supply, determined by
       * comparing the company's registered state against the customer/supplier
       * state. Set at document creation; governs which tax column is populated.
       */
      supplyType: {
        type: String,
        enum: ['intra', 'inter', 'exempt'],
        default: 'intra',
      },

      /**
       * Snapshotted GSTIN of the counterparty (customer or supplier) at the
       * time the document is raised. Required by GSTR-1 to classify B2B (has
       * GSTIN) vs B2C (no GSTIN). Stored here so it survives a master edit.
       */
      partyGstin: { type: String, trim: true, uppercase: true, default: null },

      notes: { type: String, trim: true, default: null },
      termsAndConditions: { type: String, trim: true, default: null },

      createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

      ...extraFields,
    },
  };

  const schema = new Schema(definition as Record<string, never>, { timestamps: true });

  // Document numbers are unique WITHIN a company — two tenants both running an
  // INV-0001 is normal and must not collide. Same reasoning as Product.sku.
  schema.index({ companyId: 1, documentNumber: 1 }, { unique: true });

  // The list screens: newest first, filtered by status and/or customer.
  schema.index({ companyId: 1, date: -1, _id: -1 });
  schema.index({ companyId: 1, status: 1, date: -1 });
  schema.index({ companyId: 1, [party.field]: 1, date: -1 });

  return schema;
}

/**
 * Kept so Phase 9/10 call sites read unchanged. New code should prefer
 * `createTradeDocumentSchema`, which says what it actually builds.
 */
export const createSalesDocumentSchema = createTradeDocumentSchema;
