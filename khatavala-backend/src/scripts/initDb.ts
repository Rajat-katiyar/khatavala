/**
 * Creates the database's collections and indexes.
 *
 * MongoDB creates a database lazily on first write, so "creating" it means
 * registering every model and syncing its indexes. Run this after cloning, or
 * whenever a schema's indexes change:
 *
 *   npm run db:init
 *
 * After upgrading an existing database to Phase 4, follow this with
 * `npm run db:seed-roles` — indexes alone will not populate the new `roleId`
 * on existing memberships, and those users would hold no permissions.
 *
 * Safe to re-run: `syncIndexes` is idempotent. It DOES drop indexes that are no
 * longer declared in the schema — it never touches documents, but a long-lived
 * database should still be pointed at a staging copy first.
 */
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

// Importing for side effects: each module registers its model on mongoose.
import { UserModel } from '../models/User.js';
import { CompanyModel } from '../models/Company.js';
import { UserCompanyRoleModel } from '../models/UserCompanyRole.js';
import { ProductModel } from '../models/Product.js';
import { BrandModel, CategoryModel, UnitModel } from '../models/Catalog.js';
import { RefreshTokenModel } from '../models/RefreshToken.js';
import { RoleModel } from '../models/Role.js';
import { InviteModel } from '../models/Invite.js';
import { AuditLogModel } from '../models/AuditLog.js';
import { WarehouseModel } from '../models/Warehouse.js';
import { StockBalanceModel } from '../models/StockBalance.js';
import { StockLedgerEntryModel } from '../models/StockLedgerEntry.js';
import { CounterModel } from '../models/Counter.js';
import { QuotationModel } from '../models/Quotation.js';
import { SalesOrderModel } from '../models/SalesOrder.js';
import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { PaymentModel } from '../models/Payment.js';
import { DeliveryChallanModel } from '../models/DeliveryChallan.js';
import { SalesReturnModel } from '../models/SalesReturn.js';
import { CreditNoteModel } from '../models/CreditNote.js';
import { PurchaseOrderModel } from '../models/PurchaseOrder.js';
import { GoodsReceiptNoteModel } from '../models/GoodsReceiptNote.js';
import { PurchaseInvoiceModel } from '../models/PurchaseInvoice.js';
import { DebitNoteModel } from '../models/DebitNote.js';
import { SupplierPaymentModel } from '../models/SupplierPayment.js';
import { AccountModel } from '../models/Account.js';
import { JournalEntryModel } from '../models/JournalEntry.js';

const MODELS = [
  UserModel,
  CompanyModel,
  UserCompanyRoleModel,
  ProductModel,
  CategoryModel,
  BrandModel,
  UnitModel,
  RefreshTokenModel,
  RoleModel,
  InviteModel,
  AuditLogModel,
  // Phase 8 — inventory. These three matter more than most: stock movements
  // run inside transactions, and a transaction that has to create a collection
  // implicitly is doing extra work on the hot path.
  WarehouseModel,
  StockBalanceModel,
  StockLedgerEntryModel,
  // Phase 9 — sales. The Counter especially: numbering runs inside the invoice
  // transaction, and creating its collection implicitly there is extra work on
  // the hot path.
  CounterModel,
  QuotationModel,
  SalesOrderModel,
  SalesInvoiceModel,
  // Phase 10 — POS, payments and reverse transactions.
  PaymentModel,
  DeliveryChallanModel,
  SalesReturnModel,
  CreditNoteModel,
  // Phase 11 — purchases.
  PurchaseOrderModel,
  GoodsReceiptNoteModel,
  PurchaseInvoiceModel,
  DebitNoteModel,
  SupplierPaymentModel,
  // Phase 12 — double-entry accounting.
  AccountModel,
  JournalEntryModel,
];

async function initDb() {
  await mongoose.connect(env.MONGO_URI);
  const db = mongoose.connection.db!;
  logger.info(`Initialising database '${db.databaseName}'`);

  for (const model of MODELS) {
    // createCollection first so the collection exists even when the model has
    // no indexes beyond the implicit _id.
    await db.createCollection(model.collection.name).catch((err: unknown) => {
      // NamespaceExists (48) just means a previous run already created it.
      if ((err as { code?: number }).code !== 48) throw err;
    });

    await model.syncIndexes();

    const indexes = await model.collection.indexes();
    logger.info(
      `  ${model.collection.name}: ${indexes.map((i) => i.name).join(', ')}`
    );
  }

  logger.info('Database ready');
  await mongoose.disconnect();
}

initDb().catch(async (err) => {
  logger.error(`Database init failed: ${(err as Error).message}`);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
