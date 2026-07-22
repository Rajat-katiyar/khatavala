import mongoose, { Types, type ClientSession, type PipelineStage } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';
import { ProductModel } from '../models/Product.js';
import { WarehouseModel } from '../models/Warehouse.js';
import { StockBalanceModel } from '../models/StockBalance.js';
import {
  StockLedgerEntryModel,
  type MovementType,
  type ReferenceType,
} from '../models/StockLedgerEntry.js';
import {
  tenantFilter,
  tenantStamp,
  type TenantContext,
} from '../middlewares/tenantScope.js';

/**
 * THE ONLY WRITER OF STOCK.
 * =========================
 * Sales, Purchase, returns and the manual screens all come through
 * `recordMovement`. Nothing else touches StockBalance, StockLedgerEntry or
 * `Product.currentStock` — the invariant this module exists to hold is:
 *
 *     StockBalance.quantity === sum(StockLedgerEntry.quantity) for that bucket
 *                           === the runningBalance on the newest entry
 *
 * and it only holds if there is exactly one code path that can move either.
 *
 * HOW IT IS MADE SAFE
 * -------------------
 * Three things, and all three are load-bearing:
 *
 *  1. `$inc`, never read-then-write. The new quantity is computed by the server
 *     inside the document write, so two concurrent movements cannot both read
 *     the same starting figure. `new: true` returns the post-update value,
 *     which becomes the ledger row's `runningBalance` — the two collections
 *     agree because the number came from the same operation, not because two
 *     pieces of arithmetic happened to match.
 *
 *  2. A TRANSACTION around the balance write and the ledger insert. Point 1
 *     makes each write atomic on its own; it does not stop the process dying
 *     between them and leaving a balance with no audit row behind it. The
 *     customer ledger compensates by hand for this (see ledger.factory.ts) as
 *     it must work on standalone Mongo — inventory requires the replica set, so
 *     it gets the real thing. A transfer is two movements, and the transaction
 *     is also what makes "leaves A" and "arrives at B" a single event that
 *     cannot half-happen.
 *
 *  3. A NEGATIVE-STOCK CHECK AFTER the increment, not before. Checking first
 *     ("do we have 5? then take 5") is a read-then-write with a race in the
 *     gap. Applying the delta and aborting the transaction if the result went
 *     below zero is the same check with no gap — the rollback is free because
 *     we are already in a transaction.
 *
 * JOINING AN OUTER TRANSACTION
 * ----------------------------
 * Every entry point takes an optional `session`. When Sales posts an invoice it
 * will open its own transaction and pass it in, so the invoice, the customer
 * ledger entry and the stock movements commit or fail as one. Passing a session
 * makes this module a participant rather than an owner: it will not commit, and
 * it will not retry — the outer transaction owns both.
 */

/* ------------------------------------------------------------------ *
 * Retry
 * ------------------------------------------------------------------ */

/**
 * `withTransaction` already retries anything the server labels transient —
 * WriteConflict included, which is what two movements against the SAME balance
 * row normally produce. What it does not retry is a duplicate key, and that is
 * reachable here: when N concurrent movements find no balance row for a bucket,
 * they all upsert, one wins and the rest hit the unique index on
 * (companyId, productId, warehouseId, batchNumber).
 *
 * That is the index doing its job — it is why the bucket cannot be created
 * twice — so the losers retry, find the row that now exists, and `$inc` it.
 * Failing the request instead would mean the first few movements against a new
 * product fail under load and succeed when run one at a time, which is the
 * worst kind of bug to be handed.
 */
const DUPLICATE_KEY = 11000;
const MAX_ATTEMPTS = 5;

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: number }).code === DUPLICATE_KEY;

/**
 * A standalone mongod rejects transactions outright. The message it gives
 * ("Transaction numbers are only allowed on a replica set member or mongos")
 * is accurate but tells a developer nothing about what to do, so translate it
 * into the one thing that fixes it.
 */
const isTransactionsUnsupported = (err: unknown): boolean => {
  const message = err instanceof Error ? err.message : String(err);
  return (
    message.includes('Transaction numbers are only allowed') ||
    message.includes('Transactions are not supported') ||
    message.includes('replica set member or mongos')
  );
};

const REPLICA_SET_REQUIRED =
  'Stock movements require a replica-set MongoDB (transactions). Start it with ' +
  '`docker compose up -d mongo` and point MONGO_URI at it — see docker-compose.yml.';

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export interface MovementInput {
  productId: string | Types.ObjectId;
  warehouseId: string | Types.ObjectId;
  batchNumber?: string | null;
  expiryDate?: Date | null;
  movementType: MovementType;
  /**
   * SIGNED. Positive adds to the warehouse, negative removes. See the sign
   * convention in StockLedgerEntry.ts — the callers that think in magnitudes
   * (transfer, damage) negate it themselves at their own boundary, where the
   * direction is obvious, rather than passing a flag down.
   */
  quantity: number;
  referenceType: ReferenceType;
  referenceId?: string | Types.ObjectId | null;
  reason?: string | null;
  timestamp?: Date;
}

export interface MovementOptions {
  /** Join a caller's transaction instead of opening one. See the header. */
  session?: ClientSession;
  /**
   * Permit the resulting balance to go below zero. Off by default and should
   * stay off for sales: negative stock is nearly always a missing purchase
   * entry, and letting it through silently means the error surfaces weeks later
   * in a valuation report. An opening-stock correction may legitimately need it.
   */
  allowNegative?: boolean;
}

const normalizeBatch = (batch?: string | null): string | null => {
  const trimmed = typeof batch === 'string' ? batch.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
};

const toObjectId = (value: string | Types.ObjectId, label: string): Types.ObjectId => {
  if (!Types.ObjectId.isValid(String(value))) {
    throw ApiError.badRequest(`${label} is not a valid id`);
  }
  return new Types.ObjectId(String(value));
};

/* ------------------------------------------------------------------ *
 * The core write
 * ------------------------------------------------------------------ */

/**
 * Applies ONE movement inside an already-open transaction.
 *
 * Deliberately private: it does no transaction management and no retrying, so
 * calling it outside a session would give you the un-atomic behaviour this
 * module exists to prevent.
 */
async function applyMovement(
  tenant: TenantContext,
  input: MovementInput,
  session: ClientSession,
  allowNegative: boolean
) {
  const productId = toObjectId(input.productId, 'productId');
  const warehouseId = toObjectId(input.warehouseId, 'warehouseId');
  const batchNumber = normalizeBatch(input.batchNumber);
  const quantity = input.quantity;

  if (!Number.isFinite(quantity)) {
    throw ApiError.badRequest('Movement quantity must be a number');
  }
  if (quantity === 0) {
    throw ApiError.badRequest('A stock movement cannot be for zero quantity');
  }

  const timestamp = input.timestamp ?? new Date();

  /**
   * The atomic step. Upsert because the first movement into a bucket creates
   * it; `new: true` so the returned quantity is the post-increment figure that
   * becomes `runningBalance`.
   */
  const balance = await StockBalanceModel.findOneAndUpdate(
    tenantFilter(tenant, { productId, warehouseId, batchNumber }),
    {
      $inc: { quantity },
      $set: {
        lastMovementAt: timestamp,
        // Only overwrite the expiry when this movement carries one — a later
        // Out movement with no expiry must not blank the batch's date.
        ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}),
      },
    },
    { new: true, upsert: true, session }
  );

  // Point 3 in the header: check AFTER the increment, inside the transaction.
  if (!allowNegative && balance.quantity < 0) {
    const available = balance.quantity - quantity; // what it was before us
    throw ApiError.badRequest(
      `Insufficient stock: ${available} available${
        batchNumber ? ` in batch ${batchNumber}` : ''
      }, tried to remove ${Math.abs(quantity)}`,
      { available, requested: Math.abs(quantity), productId: String(productId) }
    );
  }

  /**
   * The company-wide roll-up Phase 7 already indexes for its low-stock listing.
   * Incremented in the SAME transaction and by the same delta, so it cannot
   * drift from the sum of the per-warehouse balances. It is a convenience
   * figure only — every stock decision reads StockBalance.
   *
   * Note this nets to zero across a transfer's two legs, which is right: moving
   * goods between your own godowns does not change what the company holds.
   */
  await ProductModel.updateOne(
    tenantFilter(tenant, { _id: productId }),
    { $inc: { currentStock: quantity } },
    { session }
  );

  const [entry] = await StockLedgerEntryModel.create(
    [
      tenantStamp(tenant, {
        productId,
        warehouseId,
        batchNumber,
        expiryDate: input.expiryDate ?? balance.expiryDate ?? null,
        movementType: input.movementType,
        quantity,
        runningBalance: balance.quantity,
        referenceType: input.referenceType,
        referenceId: input.referenceId
          ? toObjectId(input.referenceId, 'referenceId')
          : null,
        reason: input.reason ?? null,
        timestamp,
        createdBy: tenant.actor?.userId ?? null,
      }),
    ],
    // `create` takes an array when given a session — the single-document form
    // silently ignores the option and would write outside the transaction.
    { session }
  );

  return { entry, balance };
}

/**
 * Runs `work` in a transaction, retrying the whole thing on a duplicate-key
 * race. If the caller supplied a session we are a participant: run inline and
 * let their transaction own the outcome.
 */
async function inTransaction<T>(
  options: MovementOptions,
  work: (session: ClientSession) => Promise<T>
): Promise<T> {
  if (options.session) return work(options.session);

  for (let attempt = 1; ; attempt++) {
    const session = await mongoose.startSession();
    try {
      let result!: T;
      // withTransaction handles commit, abort, and retry of transient errors.
      await session.withTransaction(async () => {
        result = await work(session);
      });
      return result;
    } catch (err) {
      if (isTransactionsUnsupported(err)) {
        throw new ApiError(500, REPLICA_SET_REQUIRED, 'REPLICA_SET_REQUIRED');
      }
      if (isDuplicateKey(err) && attempt < MAX_ATTEMPTS) {
        logger.debug(`Stock balance upsert raced; retrying (attempt ${attempt})`);
        continue;
      }
      throw err;
    } finally {
      await session.endSession();
    }
  }
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Records a single stock movement atomically.
 *
 * This is the entry point every other module uses. Sales will call it with its
 * own `session` so the invoice and the stock it consumes commit together.
 */
export async function recordMovement(
  tenant: TenantContext,
  input: MovementInput,
  options: MovementOptions = {}
) {
  return inTransaction(options, (session) =>
    applyMovement(tenant, input, session, options.allowNegative ?? false)
  );
}

/**
 * Records several movements as ONE atomic event — all of them land or none do.
 *
 * A transfer is the obvious case (stock must not leave A without arriving at
 * B), but so is an invoice with five lines: five separate transactions would
 * let the third fail and leave two products decremented for a bill that was
 * never raised.
 *
 * Applied in order rather than in parallel: `Promise.all` inside a session is
 * not safe — a ClientSession cannot have two operations in flight at once.
 */
export async function recordMovements(
  tenant: TenantContext,
  inputs: MovementInput[],
  options: MovementOptions = {}
) {
  if (inputs.length === 0) throw ApiError.badRequest('No stock movements supplied');

  return inTransaction(options, async (session) => {
    const results = [];
    for (const input of inputs) {
      results.push(
        await applyMovement(tenant, input, session, options.allowNegative ?? false)
      );
    }
    return results;
  });
}

/* ---------------------------- Opening ---------------------------- */

/** Materialises opening stock as a product's first movement. */
export async function recordOpeningStock(
  tenant: TenantContext,
  input: {
    productId: string;
    warehouseId: string;
    quantity: number;
    batchNumber?: string | null;
    expiryDate?: Date | null;
    timestamp?: Date;
  },
  options: MovementOptions = {}
) {
  if (input.quantity <= 0) {
    throw ApiError.badRequest('Opening stock must be a positive quantity');
  }
  await assertProductAndWarehouse(tenant, input.productId, input.warehouseId);

  return recordMovement(
    tenant,
    {
      ...input,
      movementType: 'In',
      referenceType: 'Opening',
      referenceId: input.productId,
      reason: 'Opening stock',
    },
    options
  );
}

/* --------------------------- Transfer ---------------------------- */

export interface TransferInput {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  /** Always positive here — this function owns the direction of each leg. */
  quantity: number;
  batchNumber?: string | null;
  expiryDate?: Date | null;
  reason?: string | null;
  timestamp?: Date;
}

/**
 * Moves stock between two warehouses as a single event.
 *
 * Both legs carry the same `referenceId` so the pair can be rendered as one
 * line in a history, and so a future reversal can find its counterpart. The
 * source leg runs first: if it takes the balance negative the transaction
 * aborts and the destination is never credited.
 */
export async function transferStock(
  tenant: TenantContext,
  input: TransferInput,
  options: MovementOptions = {}
) {
  if (input.quantity <= 0) {
    throw ApiError.badRequest('Transfer quantity must be positive');
  }
  if (String(input.fromWarehouseId) === String(input.toWarehouseId)) {
    throw ApiError.badRequest('Source and destination warehouses must differ');
  }

  await assertProductAndWarehouse(tenant, input.productId, input.fromWarehouseId);
  await assertWarehouse(tenant, input.toWarehouseId);

  // Shared id for the two legs. Generated rather than read from a Transfer
  // document because a transfer has no document of its own — the ledger pair
  // IS the record of it.
  const referenceId = new Types.ObjectId();
  const timestamp = input.timestamp ?? new Date();

  const common = {
    productId: input.productId,
    batchNumber: input.batchNumber,
    expiryDate: input.expiryDate,
    movementType: 'Transfer' as const,
    referenceType: 'Transfer' as const,
    referenceId,
    reason: input.reason ?? null,
    timestamp,
  };

  const [out, into] = await recordMovements(
    tenant,
    [
      { ...common, warehouseId: input.fromWarehouseId, quantity: -input.quantity },
      { ...common, warehouseId: input.toWarehouseId, quantity: input.quantity },
    ],
    options
  );

  return { referenceId, out, in: into };
}

/* -------------------------- Adjustment --------------------------- */

export interface AdjustmentInput {
  productId: string;
  warehouseId: string;
  /** Signed: positive writes stock on, negative writes it off. */
  quantity: number;
  reason: string;
  batchNumber?: string | null;
  expiryDate?: Date | null;
  timestamp?: Date;
}

/**
 * A manual correction — a stock count found more or fewer than the books say.
 *
 * `reason` is required by the validator and again here: an adjustment with no
 * explanation is indistinguishable from someone covering a theft, and the whole
 * point of an append-only ledger is that the explanation survives.
 */
export async function adjustStock(
  tenant: TenantContext,
  input: AdjustmentInput,
  options: MovementOptions = {}
) {
  if (!input.reason?.trim()) {
    throw ApiError.badRequest('An adjustment needs a reason');
  }
  await assertProductAndWarehouse(tenant, input.productId, input.warehouseId);

  return recordMovement(
    tenant,
    {
      ...input,
      reason: input.reason.trim(),
      movementType: 'Adjustment',
      referenceType: 'Adjustment',
    },
    options
  );
}

/**
 * Stock written off as damaged, expired or lost.
 *
 * Separate from `adjustStock` even though the mechanics are the same, because
 * the two answer different questions: an adjustment is "the count was wrong",
 * damage is "we lost this". Merging them would make wastage unreportable, and
 * wastage is exactly what a shop wants a number for. `quantity` is a positive
 * magnitude at this boundary and is negated here.
 */
export async function recordDamage(
  tenant: TenantContext,
  input: Omit<AdjustmentInput, 'quantity'> & { quantity: number },
  options: MovementOptions = {}
) {
  if (input.quantity <= 0) {
    throw ApiError.badRequest('Damaged quantity must be positive');
  }
  if (!input.reason?.trim()) {
    throw ApiError.badRequest('Damaged stock needs a reason');
  }
  await assertProductAndWarehouse(tenant, input.productId, input.warehouseId);

  return recordMovement(
    tenant,
    {
      ...input,
      quantity: -input.quantity,
      reason: input.reason.trim(),
      movementType: 'Damage',
      referenceType: 'Damage',
    },
    options
  );
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/**
 * Existence checks, tenant-scoped.
 *
 * The `$inc` upsert would otherwise happily create a balance row for a product
 * id that does not exist — or worse, one belonging to another tenant, since the
 * upsert stamps OUR companyId onto it. So these run before any write.
 */
async function assertWarehouse(tenant: TenantContext, warehouseId: string) {
  const exists = await WarehouseModel.exists(
    tenantFilter(tenant, { _id: toObjectId(warehouseId, 'warehouseId') })
  );
  if (!exists) throw ApiError.notFound('Warehouse not found');
}

async function assertProductAndWarehouse(
  tenant: TenantContext,
  productId: string,
  warehouseId: string
) {
  const [product] = await Promise.all([
    ProductModel.exists(tenantFilter(tenant, { _id: toObjectId(productId, 'productId') })),
    assertWarehouse(tenant, warehouseId),
  ]);
  if (!product) throw ApiError.notFound('Product not found');
}

export interface CurrentStockQuery {
  productId?: string;
  warehouseId?: string;
  search?: string;
  /** Only products at or below their `minStockLevel`. */
  lowOnly?: boolean;
  includeZero?: boolean;
  page?: number;
  limit?: number;
}

/**
 * Current stock, grouped by product with a per-warehouse breakdown.
 *
 * One aggregation rather than a query per product: the listing shows every
 * product a company holds, and N+1 lookups over a few thousand SKUs is the
 * difference between a page that loads and one that times out.
 *
 * `minStockLevel` comes from the product and is compared against the TOTAL
 * across warehouses, not per warehouse — a reorder decision is a company-level
 * one. When the caller filters to a single warehouse the total is that
 * warehouse's, which is the answer they asked for.
 */
export async function getCurrentStock(tenant: TenantContext, query: CurrentStockQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));

  const match: Record<string, unknown> = {};
  if (query.productId) match.productId = toObjectId(query.productId, 'productId');
  if (query.warehouseId) match.warehouseId = toObjectId(query.warehouseId, 'warehouseId');

  const pipeline: PipelineStage[] = [
    { $match: tenantFilter(tenant, match) },
    {
      // Batches roll up into one row per product+warehouse, keeping the batch
      // detail nested so the UI can expand it without a second request.
      $group: {
        _id: { productId: '$productId', warehouseId: '$warehouseId' },
        quantity: { $sum: '$quantity' },
        lastMovementAt: { $max: '$lastMovementAt' },
        batches: {
          $push: {
            batchNumber: '$batchNumber',
            expiryDate: '$expiryDate',
            quantity: '$quantity',
          },
        },
      },
    },
    {
      $group: {
        _id: '$_id.productId',
        totalQuantity: { $sum: '$quantity' },
        lastMovementAt: { $max: '$lastMovementAt' },
        warehouses: {
          $push: {
            warehouseId: '$_id.warehouseId',
            quantity: '$quantity',
            batches: '$batches',
          },
        },
      },
    },
    {
      $lookup: {
        from: ProductModel.collection.name,
        localField: '_id',
        foreignField: '_id',
        as: 'product',
        pipeline: [
          {
            $project: {
              name: 1,
              sku: 1,
              minStockLevel: 1,
              trackBatch: 1,
              sellingPrice: 1,
              purchasePrice: 1,
            },
          },
        ],
      },
    },
    { $unwind: '$product' },
    {
      $addFields: {
        // A product with no reorder level set is never "low" — treating 0 as a
        // threshold would flag every out-of-stock item a shop has deliberately
        // stopped carrying.
        isLowStock: {
          $and: [
            { $gt: ['$product.minStockLevel', 0] },
            { $lte: ['$totalQuantity', '$product.minStockLevel'] },
          ],
        },
        stockValue: { $multiply: ['$totalQuantity', { $ifNull: ['$product.purchasePrice', 0] }] },
      },
    },
  ];

  if (!query.includeZero) pipeline.push({ $match: { totalQuantity: { $ne: 0 } } });
  if (query.lowOnly) pipeline.push({ $match: { isLowStock: true } });
  if (query.search) {
    const rx = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    pipeline.push({ $match: { $or: [{ 'product.name': rx }, { 'product.sku': rx }] } });
  }

  pipeline.push({
    $facet: {
      rows: [
        { $sort: { isLowStock: -1, 'product.name': 1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ],
      total: [{ $count: 'count' }],
      summary: [
        {
          $group: {
            _id: null,
            products: { $sum: 1 },
            lowStock: { $sum: { $cond: ['$isLowStock', 1, 0] } },
            stockValue: { $sum: '$stockValue' },
          },
        },
      ],
    },
  });

  const [result] = await StockBalanceModel.aggregate(pipeline);
  const warehouses = await listWarehouseLabels(tenant);

  return {
    // Warehouse names are attached here rather than $lookup-ed per row: a
    // company has a handful of warehouses and the client needs the full list
    // anyway to render the filter.
    warehouses,
    items: (result?.rows ?? []).map((row: any) => ({
      productId: row._id,
      name: row.product.name,
      sku: row.product.sku,
      minStockLevel: row.product.minStockLevel,
      trackBatch: row.product.trackBatch,
      totalQuantity: row.totalQuantity,
      stockValue: row.stockValue,
      isLowStock: row.isLowStock,
      lastMovementAt: row.lastMovementAt,
      warehouses: row.warehouses,
    })),
    pagination: {
      page,
      limit,
      total: result?.total?.[0]?.count ?? 0,
      pages: Math.ceil((result?.total?.[0]?.count ?? 0) / limit),
    },
    summary: {
      products: result?.summary?.[0]?.products ?? 0,
      lowStock: result?.summary?.[0]?.lowStock ?? 0,
      stockValue: result?.summary?.[0]?.stockValue ?? 0,
    },
  };
}

async function listWarehouseLabels(tenant: TenantContext) {
  return WarehouseModel.find(tenantFilter(tenant, { isActive: true }))
    .select('name isDefault')
    .sort({ isDefault: -1, name: 1 })
    .lean();
}

export interface MovementHistoryQuery {
  productId?: string;
  warehouseId?: string;
  movementType?: MovementType;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

/**
 * The movement ledger, newest first, filterable.
 *
 * Sorted by `timestamp` then `_id` — the `_id` tiebreak is what stops two
 * movements posted in the same millisecond from swapping order between pages
 * and making the running-balance column read as if the arithmetic were wrong.
 */
export async function getMovementHistory(
  tenant: TenantContext,
  query: MovementHistoryQuery = {}
) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(200, Math.max(1, query.limit ?? 50));

  const filter: Record<string, unknown> = {};
  if (query.productId) filter.productId = toObjectId(query.productId, 'productId');
  if (query.warehouseId) filter.warehouseId = toObjectId(query.warehouseId, 'warehouseId');
  if (query.movementType) filter.movementType = query.movementType;
  if (query.from || query.to) {
    filter.timestamp = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  const scoped = tenantFilter(tenant, filter);

  const [entries, total] = await Promise.all([
    StockLedgerEntryModel.find(scoped)
      .sort({ timestamp: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('warehouseId', 'name')
      .populate('productId', 'name sku')
      .lean(),
    StockLedgerEntryModel.countDocuments(scoped),
  ]);

  return {
    entries,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/**
 * Recomputes StockBalance from the ledger and reports any disagreement.
 *
 * Nothing in normal operation needs this — the transaction is what keeps the
 * two in step. It exists because "derivable from the ledger" is only a real
 * property if something actually derives it: this is the check that proves the
 * invariant holds, and the thing to reach for if a future writer ever bypasses
 * `recordMovement`. Read-only; it reports, it does not repair.
 *
 * ON THE TOLERANCE: quantities are IEEE doubles, in Mongo as everywhere else,
 * and stock is legitimately fractional (1.5 kg, 0.25 m). So a balance built by
 * a few hundred `$inc`s of 0.2 lands on 204.99999999999943 while summing the
 * same rows in one `$group` gives exactly 205 — the two disagree in the 14th
 * decimal place because they added the same numbers in a different order, not
 * because a movement went missing. Comparing exactly would report every busy
 * fractional product as corrupt and train whoever reads this to ignore it.
 * EPSILON is far below any real stock unit and far above the accumulated error,
 * so a genuine lost movement — off by a whole unit at least — still trips it.
 */
const EPSILON = 1e-6;

export async function verifyBalances(tenant: TenantContext) {
  const derived = await StockLedgerEntryModel.aggregate([
    { $match: tenantFilter(tenant, {}) },
    {
      $group: {
        _id: {
          productId: '$productId',
          warehouseId: '$warehouseId',
          batchNumber: '$batchNumber',
        },
        quantity: { $sum: '$quantity' },
      },
    },
  ]);

  const balances = await StockBalanceModel.find(tenantFilter(tenant, {})).lean();
  const key = (b: { productId: unknown; warehouseId: unknown; batchNumber?: unknown }) =>
    `${b.productId}|${b.warehouseId}|${b.batchNumber ?? ''}`;

  const stored = new Map(balances.map((b) => [key(b), b.quantity]));
  const mismatches: {
    key: string;
    ledgerSum: number;
    storedBalance: number | undefined;
  }[] = [];

  for (const row of derived) {
    const k = key(row._id);
    const storedQty = stored.get(k);
    if (storedQty === undefined || Math.abs(storedQty - row.quantity) > EPSILON) {
      mismatches.push({ key: k, ledgerSum: row.quantity, storedBalance: storedQty });
    }
    stored.delete(k);
  }
  // Anything left has a balance row but no movements behind it.
  for (const [k, storedQty] of stored) {
    if (Math.abs(storedQty) > EPSILON) {
      mismatches.push({ key: k, ledgerSum: 0, storedBalance: storedQty });
    }
  }

  return { checked: derived.length, mismatches, ok: mismatches.length === 0 };
}
