export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

export interface HealthData {
  status: string;
  uptime: number;
  services: { mongo: string; redis: string };
}

export const ROLES = [
  'SuperAdmin',
  'Owner',
  'Manager',
  'Cashier',
  'Accountant',
  'StoreKeeper',
  'Employee',
] as const;

export type Role = (typeof ROLES)[number];

export interface User {
  _id: string;
  email: string;
  fullName: string;
  phoneNumber?: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface AuthPayload {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface CompanyAddress {
  line1?: string;
  line2?: string;
  city?: string;
  pincode?: string;
}

export interface Company {
  _id: string;
  name: string;
  gstNumber?: string;
  panNumber?: string;
  address?: CompanyAddress;
  state?: string;
  /** Month index, 1-12. 4 = April, the Indian financial year default. */
  financialYearStart: number;
  currency: string;
  timeZone: string;
  logoUrl?: string;
  invoicePrefix: string;
  isActive: boolean;
  ownerId: string;
  createdAt: string;
}

/** A company plus the current user's role *in that company*. */
export interface CompanyMembership {
  company: Company;
  role: Role;
  branchId: string | null;
  warehouseId: string | null;
}

/** Response of POST /companies/:id/activate â€” carries the re-scoped token. */
export interface ActivateCompanyPayload {
  accessToken: string;
  company: Company;
  role: Role;
  branchId: string | null;
  warehouseId: string | null;
}

/* ------------------------------ Catalog ------------------------------ */

export interface Category {
  _id: string;
  name: string;
  description?: string;
  parentId?: string | null;
  isActive: boolean;
  /** Present only on the `?withUsage=true` listing. */
  productCount?: number;
}

export interface Brand {
  _id: string;
  name: string;
  description?: string;
  isActive: boolean;
  productCount?: number;
}

export interface Unit {
  _id: string;
  name: string;
  symbol: string;
  allowsDecimal: boolean;
  isActive: boolean;
  productCount?: number;
}

/** A master reference is an id until the API populates it. */
export type Ref<T> = string | T | null;

export interface Product {
  _id: string;
  companyId: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: Ref<Pick<Category, '_id' | 'name'>>;
  brandId: Ref<Pick<Brand, '_id' | 'name'>>;
  hsnCode: string | null;
  gstPercentage: number;
  primaryUnitId: Ref<Unit>;
  secondaryUnitId: Ref<Unit>;
  conversionFactor: number | null;
  purchasePrice: number;
  sellingPrice: number;
  mrp: number;
  wholesalePrice: number;
  /** Set once at creation; thereafter inventory-owned and read-only. */
  openingStock: number;
  currentStock: number;
  minStockLevel: number;
  maxStockLevel: number;
  trackBatch: boolean;
  trackExpiry: boolean;
  trackSerial: boolean;
  imageUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductPage {
  products: Product[];
  pagination: Pagination;
}

export interface ProductStats {
  total: number;
  active: number;
  lowStock: number;
  outOfStock: number;
  /** Valued at purchase price, not selling price. */
  stockValue: number;
}

export type StockStatus = 'all' | 'low' | 'out' | 'in';

export interface ProductImportResult extends ImportResult {
  createdCategories: string[];
  createdBrands: string[];
}

export const SYMBOLOGIES = ['code128', 'ean13', 'ean8', 'upca', 'code39'] as const;
export type Symbology = (typeof SYMBOLOGIES)[number];

/* ---------------------------------------------------------------- RBAC --- */

/**
 * A permission key, `module.action` â€” e.g. `sales.create`. Kept as a template
 * literal rather than a union of every key: the catalog is served by the
 * backend at /roles/permissions, so hard-coding the full list here would give
 * two sources of truth that drift.
 */
export type Permission = `${string}.${string}`;

export interface PermissionAction {
  action: string;
  key: Permission;
}

export interface PermissionModule {
  module: string;
  label: string;
  description: string;
  actions: PermissionAction[];
}

export interface CompanyRole {
  _id: string;
  companyId: string;
  name: string;
  description: string;
  /** As stored â€” may contain `*` or `sales.*` wildcards. */
  permissions: Permission[];
  /** Wildcards expanded to concrete keys. What the matrix checkboxes reflect. */
  effectivePermissions: Permission[];
  isSystem: boolean;
  isDefault: boolean;
  userCount: number;
  createdAt: string;
}

export interface CompanyUser {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  phoneNumber: string | null;
  roleId: string | null;
  roleIds?: string[];
  roleName: string;
  roleNames?: string[];
  isSystemRole: boolean;
  /** Membership status in this company â€” a revoke flips this, not the account. */
  isActive: boolean;
  /** The user's platform account status. */
  accountActive: boolean;
  joinedAt: string | null;
}

export interface PendingInvite {
  _id: string;
  email: string;
  roleId: string;
  roleName: string;
  expiresAt: string;
  createdAt: string | null;
}

export interface CompanyUsersPayload {
  users: CompanyUser[];
  invites: PendingInvite[];
}

export interface InvitePreview {
  email: string;
  roleName: string;
  companyName: string;
  hasAccount: boolean;
  expiresAt: string;
}

export interface EffectivePermissions {
  roleName: string;
  permissions: Permission[];
  effectivePermissions: Permission[];
}

export interface AuditLogEntry {
  _id: string;
  companyId: string;
  userId: string | null;
  user: { _id: string; fullName: string; email: string } | null;
  action: string;
  entityName: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  userAgent: string | null;
  timestamp: string;
}

export interface AuditLogPage {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/* ----------------------------- Customers ----------------------------- */

export interface CustomerAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

export interface Customer {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  gstNumber?: string;
  pan?: string;
  billingAddress?: CustomerAddress;
  shippingAddress?: CustomerAddress;
  creditLimit: number;
  /** Set once at creation; thereafter ledger-owned and read-only. */
  openingBalance: number;
  /** Positive = the customer owes us. Negative = they are in credit. */
  currentBalance: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface CustomerPage {
  customers: Customer[];
  pagination: Pagination;
}

export const LEDGER_ENTRY_TYPES = ['Opening', 'Invoice', 'Payment', 'CreditNote'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface CustomerLedgerEntry {
  _id: string;
  customerId: string;
  date: string;
  type: LedgerEntryType;
  debit: number;
  credit: number;
  /** The customer's balance immediately after this entry. */
  runningBalance: number;
  referenceModel: string;
  referenceId: string;
  narration?: string;
}

export interface CustomerLedger {
  customer: Pick<Customer, '_id' | 'name' | 'phone' | 'currentBalance' | 'creditLimit'>;
  entries: CustomerLedgerEntry[];
  /** Balance carried into the filtered period; 0 when unfiltered. */
  openingForPeriod: number;
  totals: { debit: number; credit: number };
  pagination: Pagination;
}

export interface OutstandingSummary {
  totals: {
    totalReceivable: number;
    totalAdvance: number;
    customersWithDues: number;
    customersOverCreditLimit: number;
  };
  customers: Array<
    Pick<Customer, '_id' | 'name' | 'phone' | 'currentBalance' | 'creditLimit'>
  >;
}

export interface ImportRowError {
  row: number;
  name?: string;
  phone?: string;
  message: string;
}

export interface ImportResult {
  imported: number;
  failed: number;
  totalRows: number;
  errors: ImportRowError[];
  dryRun: boolean;
}

/* ----------------------------- Suppliers ----------------------------- */

export interface Supplier {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  gstNumber?: string;
  pan?: string;
  address?: CustomerAddress;
  /** Set once at creation; thereafter ledger-owned and read-only. */
  openingBalance: number;
  /**
   * Payable. Positive = WE OWE THEM â€” the inverse column convention to
   * Customer.currentBalance, which reaches the same "positive = outstanding"
   * reading from the debit side. See the backend ledger.factory.ts note.
   */
  currentBalance: number;
  vendorRating: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierPage {
  suppliers: Supplier[];
  pagination: Pagination;
}

export const SUPPLIER_LEDGER_ENTRY_TYPES = [
  'Opening',
  'PurchaseInvoice',
  'Payment',
  'DebitNote',
] as const;
export type SupplierLedgerEntryType = (typeof SUPPLIER_LEDGER_ENTRY_TYPES)[number];

export interface SupplierLedgerEntry {
  _id: string;
  supplierId: string;
  date: string;
  type: SupplierLedgerEntryType;
  /** Reduces the payable â€” a payment made, or a debit note. */
  debit: number;
  /** Increases the payable â€” a purchase bill. */
  credit: number;
  runningBalance: number;
  referenceModel: string;
  referenceId: string;
  narration?: string;
  dueDate?: string | null;
}

export interface SupplierLedger {
  supplier: Pick<Supplier, '_id' | 'name' | 'phone' | 'currentBalance' | 'vendorRating'>;
  entries: SupplierLedgerEntry[];
  openingForPeriod: number;
  totals: { debit: number; credit: number };
  pagination: Pagination;
}

export interface PayablesSummary {
  totals: {
    totalPayable: number;
    totalAdvancePaid: number;
    suppliersWithDues: number;
  };
  suppliers: Array<
    Pick<Supplier, '_id' | 'name' | 'phone' | 'currentBalance' | 'vendorRating'>
  >;
}

export interface PaymentReminderBill extends SupplierLedgerEntry {
  daysOverdue: number;
  status: 'overdue' | 'dueSoon' | 'upcoming';
}

export interface PaymentReminders {
  supplier: Pick<Supplier, '_id' | 'name' | 'currentBalance'>;
  bills: PaymentReminderBill[];
  totals: { overdue: number; dueSoon: number; overdueAmount: number };
}

/* ------------------------------------------------------------------ *
 * Phase 8 â€” inventory
 * ------------------------------------------------------------------ */

export interface Warehouse {
  _id: string;
  name: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
  };
  isDefault: boolean;
  isActive: boolean;
}

export type MovementType = 'In' | 'Out' | 'Transfer' | 'Adjustment' | 'Damage';

export interface StockBatch {
  batchNumber: string | null;
  expiryDate: string | null;
  quantity: number;
}

export interface StockByWarehouse {
  warehouseId: string;
  quantity: number;
  batches: StockBatch[];
}

export interface StockRow {
  productId: string;
  name: string;
  sku: string;
  minStockLevel: number;
  trackBatch: boolean;
  totalQuantity: number;
  stockValue: number;
  isLowStock: boolean;
  lastMovementAt: string | null;
  warehouses: StockByWarehouse[];
}

export interface CurrentStock {
  warehouses: Array<Pick<Warehouse, '_id' | 'name' | 'isDefault'>>;
  items: StockRow[];
  pagination: Pagination;
  summary: { products: number; lowStock: number; stockValue: number };
}

export interface StockMovement {
  _id: string;
  /** Populated by the API to `{ _id, name, sku }`. */
  productId: { _id: string; name: string; sku: string } | string;
  /** Populated by the API to `{ _id, name }`. */
  warehouseId: { _id: string; name: string } | string;
  batchNumber: string | null;
  expiryDate: string | null;
  movementType: MovementType;
  /** Signed: positive in, negative out. See StockLedgerEntry.ts on the server. */
  quantity: number;
  runningBalance: number;
  referenceType: string;
  referenceId: string | null;
  reason: string | null;
  timestamp: string;
}

export interface MovementHistory {
  entries: StockMovement[];
  pagination: Pagination;
}

/* ------------------------------------------------------------------ *
 * Phase 9 â€” sales
 * ------------------------------------------------------------------ */

export type QuotationStatus =
  | 'Draft' | 'Sent' | 'Accepted' | 'Rejected' | 'Expired' | 'Converted';
export type SalesOrderStatus =
  | 'Draft' | 'Confirmed' | 'PartiallyDelivered' | 'Delivered' | 'Cancelled' | 'Converted';
export type InvoiceStatus =
  | 'Draft' | 'Unpaid' | 'PartiallyPaid' | 'Paid' | 'Cancelled';
export type SalesDocumentStatus = QuotationStatus | SalesOrderStatus | InvoiceStatus;

/** Which of the three collections a document belongs to. */
export type SalesDocumentKind = 'quotations' | 'orders' | 'invoices';

export interface SalesLineItem {
  _id?: string;
  productId: string;
  /** Snapshotted at creation â€” not read live from the product master. */
  name: string;
  sku?: string;
  hsnCode?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  gstPercent: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  lineTotal: number;
  warehouseId?: string | null;
  batchNumber?: string | null;
}

export interface SalesDocument {
  _id: string;
  documentNumber: string;
  /** Populated to the customer object on getById, a plain id in lists. */
  customerId: string | { _id: string; name: string; phone?: string; gstNumber?: string };
  customerName: string;
  date: string;
  dueDate?: string | null;
  lineItems: SalesLineItem[];
  subTotal: number;
  totalDiscount: number;
  totalTax: number;
  roundOff: number;
  grandTotal: number;
  status: SalesDocumentStatus;
  sourceDocumentId?: string | null;
  sourceDocumentModel?: string | null;
  convertedToId?: string | null;
  convertedToModel?: string | null;
  notes?: string | null;
  termsAndConditions?: string | null;
  createdAt: string;

  // Quotation-only.
  validUntil?: string | null;
  // Sales-order-only.
  expectedDeliveryDate?: string | null;
  // Invoice-only.
  amountPaid?: number;
  returnedAmount?: number;
  postedAt?: string | null;
}

export interface SalesDocumentPage {
  documents: SalesDocument[];
  summary: { count: number; value: number };
  pagination: Pagination;
}

export interface SalesChainLink {
  _id: string;
  documentNumber: string;
  status: SalesDocumentStatus;
  date: string;
  grandTotal: number;
  model: string;
}

export interface SalesDocumentDetail {
  document: SalesDocument;
  chain: { source: SalesChainLink | null; target: SalesChainLink | null };
}

/* ------------------------------------------------------------------ *
 * Phase 10 â€” POS, payments, returns
 * ------------------------------------------------------------------ */

export type PaymentMode = 'Cash' | 'UPI' | 'Card' | 'Bank' | 'Cheque';

export interface Payment {
  _id: string;
  documentNumber: string;
  invoiceId: string;
  customerId: string;
  amount: number;
  mode: PaymentMode;
  date: string;
  referenceNumber?: string | null;
  notes?: string | null;
  /** True when money went OUT â€” a refund, stored positive with this flag. */
  isReversal: boolean;
  salesReturnId?: string | null;
}

export interface PaymentHistory {
  invoice: {
    documentNumber: string;
    grandTotal: number;
    amountPaid: number;
    status: InvoiceStatus;
    customerName: string;
  };
  payments: Payment[];
  totals: { received: number; outstanding: number };
}

export interface PosCartLine {
  productId: string;
  quantity: number;
  unitPrice?: number;
  discountPercent?: number;
}

export interface PosCheckoutResult {
  invoice: SalesDocument;
  payment: Payment | null;
  change: number;
}

export interface PosProduct {
  _id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  sellingPrice: number;
  gstPercentage: number;
  currentStock: number;
  imageUrl?: string | null;
}

export type ReturnReason =
  | 'Damaged' | 'Expired' | 'WrongItem' | 'NotRequired' | 'QualityIssue' | 'Other';

export interface ReturnableLine {
  lineItemId: string;
  productId: string;
  name: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  gstPercent: number;
  lineTotal: number;
  alreadyReturned: number;
  returnable: number;
}

export interface ReturnableInvoice {
  invoice: {
    _id: string;
    documentNumber: string;
    customerId: string;
    customerName: string;
    date: string;
    status: InvoiceStatus;
    grandTotal: number;
    amountPaid: number;
    returnedAmount: number;
  };
  lines: ReturnableLine[];
  previousReturns: Array<{
    _id: string;
    documentNumber: string;
    date: string;
    grandTotal: number;
    reason: ReturnReason;
  }>;
}

export interface SalesReturnResult {
  salesReturn: SalesDocument & {
    invoiceNumber: string;
    reason: ReturnReason;
    refundedAmount: number;
  };
  creditNote: SalesDocument & { invoiceNumber: string };
}

export interface Receipt {
  invoice: SalesDocument;
  company: {
    name: string;
    address?: { line1?: string; line2?: string; city?: string; pincode?: string };
    state?: string;
    gstNumber?: string;
    currency?: string;
  } | null;
  payments: Payment[];
  totals: { received: number; outstanding: number };
}

/* ------------------------------------------------------------------ *
 * Phase 11 â€” purchases
 * ------------------------------------------------------------------ */

export type PurchaseOrderStatus =
  | 'Draft' | 'Sent' | 'Confirmed' | 'PartiallyReceived' | 'Received'
  | 'Cancelled' | 'Converted';
export type GrnStatus = 'Draft' | 'Received' | 'Cancelled';
export type PurchaseInvoiceStatus =
  | 'Draft' | 'Unpaid' | 'PartiallyPaid' | 'Paid' | 'Cancelled';

export type PurchaseDocumentKind = 'orders' | 'grn' | 'invoices' | 'returns';

export type PurchaseReturnReason =
  | 'Damaged' | 'Expired' | 'WrongItem' | 'ShortSupply'
  | 'QualityIssue' | 'RateDifference' | 'Other';

/**
 * A purchase document. Structurally identical to SalesDocument with the party
 * swapped â€” the backend builds both from one shared schema.
 */
export interface PurchaseDocument {
  _id: string;
  documentNumber: string;
  supplierId: string | { _id: string; name: string; phone?: string; gstNumber?: string };
  supplierName: string;
  date: string;
  dueDate?: string | null;
  lineItems: PurchaseLineItem[];
  subTotal: number;
  totalDiscount: number;
  totalTax: number;
  roundOff: number;
  grandTotal: number;
  status: PurchaseOrderStatus | GrnStatus | PurchaseInvoiceStatus | 'Issued';
  notes?: string | null;
  createdAt: string;

  // Purchase-order-only.
  expectedDate?: string | null;
  // GRN-only.
  purchaseOrderId?: string | null;
  purchaseOrderNumber?: string | null;
  supplierDocumentNumber?: string | null;
  receivedAt?: string | null;
  purchaseInvoiceId?: string | null;
  // Bill-only.
  grnId?: string | null;
  supplierInvoiceNumber?: string | null;
  supplierInvoiceDate?: string | null;
  receivesStock?: boolean;
  amountPaid?: number;
  returnedAmount?: number;
  postedAt?: string | null;
  // Debit-note-only.
  purchaseInvoiceNumber?: string;
  reason?: PurchaseReturnReason;
  refundedAmount?: number;

  warehouseId?: string | null;
}

export interface PurchaseLineItem {
  _id?: string;
  productId: string;
  name: string;
  sku?: string;
  hsnCode?: string | null;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  gstPercent: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  lineTotal: number;
  warehouseId?: string | null;
  batchNumber?: string | null;
  /** Set on GRN lines copied from an order. */
  sourceLineItemId?: string | null;
  orderedQuantity?: number | null;
  rejectedQuantity?: number;
}

export interface PurchaseDocumentPage {
  documents: PurchaseDocument[];
  summary?: { count: number; value: number };
  pagination: Pagination;
}

export interface SupplierPayment {
  _id: string;
  documentNumber: string;
  purchaseInvoiceId: string;
  supplierId: string;
  amount: number;
  mode: PaymentMode;
  date: string;
  referenceNumber?: string | null;
  isReversal: boolean;
}

export interface SupplierPaymentHistory {
  purchaseInvoice: {
    documentNumber: string;
    grandTotal: number;
    amountPaid: number;
    status: PurchaseInvoiceStatus;
    supplierName: string;
  };
  payments: SupplierPayment[];
  totals: { received: number; outstanding: number };
}

export interface PurchaseReturnableLine {
  lineItemId: string;
  productId: string;
  name: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  gstPercent: number;
  lineTotal: number;
  alreadyReturned: number;
  returnable: number;
}

export interface PurchaseReturnable {
  purchaseInvoice: {
    _id: string;
    documentNumber: string;
    supplierId: string;
    supplierName: string;
    date: string;
    status: PurchaseInvoiceStatus;
    grandTotal: number;
    amountPaid: number;
    returnedAmount: number;
  };
  lines: PurchaseReturnableLine[];
  previousReturns: Array<{
    _id: string;
    documentNumber: string;
    date: string;
    grandTotal: number;
    reason: PurchaseReturnReason;
  }>;
}

/* ------------------------------------------------------------------ *
 * Phase 12 â€” accounting
 * ------------------------------------------------------------------ */

export type AccountType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense';

export interface Account {
  _id: string;
  accountName: string;
  accountType: AccountType;
  code?: string | null;
  parentAccountId?: string | null;
  /** Set on accounts the posting service resolves by role; never client-set. */
  systemKey?: string | null;
  isSystem: boolean;
  isActive: boolean;
  description?: string | null;
}

export interface AccountNode {
  _id: string;
  accountName: string;
  accountType: AccountType;
  code: string | null;
  systemKey: string | null;
  isSystem: boolean;
  isActive: boolean;
  children: AccountNode[];
}

export type JournalSourceType =
  | 'SalesInvoice' | 'PurchaseInvoice' | 'CustomerReceipt' | 'SupplierPayment'
  | 'CreditNote' | 'DebitNote' | 'Manual' | 'Contra' | 'Reversal';

export interface JournalLine {
  _id?: string;
  accountId: string;
  accountName: string;
  debitAmount: number;
  creditAmount: number;
  description?: string | null;
}

export interface JournalEntry {
  _id: string;
  documentNumber: string;
  date: string;
  narration?: string | null;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  sourceType: JournalSourceType;
  sourceId?: string | null;
  sourceNumber?: string | null;
  reversesEntryId?: string | null;
  reversedByEntryId?: string | null;
}

export interface JournalEntryPage {
  entries: JournalEntry[];
  pagination: Pagination;
}

export interface LedgerRow {
  entryId: string;
  documentNumber: string;
  date: string;
  narration?: string | null;
  sourceType: JournalSourceType;
  sourceNumber?: string | null;
  accountId: string;
  accountName: string;
  description?: string | null;
  debit: number;
  credit: number;
  runningBalance: number;
}

export interface AccountLedger {
  account?: {
    _id: string;
    accountName: string;
    accountType: AccountType;
    normalBalance: 'debit' | 'credit';
  };
  /** Cash/bank books only. */
  book?: string;
  opening: number;
  entries: LedgerRow[];
  totals: { debit: number; credit: number; net: number };
  closing: number;
  pagination: Pagination;
}

export interface TrialBalanceRow {
  accountId: string;
  accountName: string;
  accountType: AccountType;
  code: string | null;
  debit: number;
  credit: number;
  normalBalance: 'debit' | 'credit';
  balance: number;
}

export interface TrialBalance {
  accounts: TrialBalanceRow[];
  totals: { debit: number; credit: number; difference: number; balanced: boolean };
}

/* ------------------------------------------------------------------ *
 * Phase 13 â€” financial reports
 * ------------------------------------------------------------------ */

/** The key a report line carries so the UI can fetch its transactions. */
export interface DrillDownKey {
  accountId: string;
  from: string | null;
  to: string | null;
  entryCount: number;
}

export interface TrialBalanceReport {
  period: { from: string | null; to: string | null };
  accounts: Array<{
    accountId: string;
    accountName: string;
    accountType: AccountType;
    code: string | null;
    debit: number;
    credit: number;
    normalBalance: 'debit' | 'credit';
    balance: number;
    drillDown: DrillDownKey;
  }>;
  totals: { debit: number; credit: number; difference: number; balanced: boolean };
}

export interface ReportLine {
  accountId: string;
  accountName: string;
  code: string | null;
  amount: number;
  drillDown: DrillDownKey;
}

export interface ProfitAndLossReport {
  period: { from: string | null; to: string | null };
  sections: {
    revenue: { lines: ReportLine[]; total: number };
    costOfSales: { lines: ReportLine[]; total: number };
    otherIncome: { lines: ReportLine[]; total: number };
    expenses: { lines: ReportLine[]; total: number };
  };
  totals: {
    netRevenue: number;
    costOfSales: number;
    grossProfit: number;
    otherIncome: number;
    expenses: number;
    netProfit: number;
    grossMarginPercent: number | null;
    netMarginPercent: number | null;
  };
}

export interface BalanceSheetReport {
  asOf: string | null;
  sections: {
    assets: { lines: ReportLine[]; total: number };
    liabilities: { lines: ReportLine[]; total: number };
    equity: {
      lines: ReportLine[];
      retainedEarnings: {
        accountName: string;
        amount: number;
        isComputed: boolean;
        breakdown: { income: number; expenses: number };
      };
      total: number;
    };
  };
  totals: {
    assets: number;
    liabilities: number;
    equity: number;
    liabilitiesAndEquity: number;
    difference: number;
    balanced: boolean;
  };
}

export interface DayBookReport {
  period: { from: string | null; to: string | null };
  entries: Array<{
    _id: string;
    documentNumber: string;
    date: string;
    narration: string | null;
    sourceType: JournalSourceType;
    sourceId: string | null;
    sourceNumber: string | null;
    reversedByEntryId: string | null;
    lines: JournalLine[];
    totalDebit: number;
    totalCredit: number;
  }>;
  totals: { debit: number; credit: number; entries: number; balanced: boolean };
}

export interface DrillDownResult {
  account: {
    _id: string;
    accountName: string;
    accountType: AccountType;
    normalBalance: 'debit' | 'credit';
  };
  period: { from: string | null; to: string | null };
  rows: Array<{
    entryId: string;
    documentNumber: string;
    date: string;
    narration: string | null;
    sourceType: JournalSourceType;
    sourceId: string | null;
    sourceNumber: string | null;
    description: string | null;
    debit: number;
    credit: number;
  }>;
  totals: { debit: number; credit: number; net: number };
  pagination: Pagination;
}

/* ------------------------------ GST — Phase 14 ------------------------------ */

export interface GSTRate {
  _id: string;
  hsnCode: string;
  description: string;
  cgstPercent: number;
  sgstPercent: number;
  igstPercent: number;
  cessPercent: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HSNSummaryRow {
  hsnCode: string;
  description: string;
  uqc: string;
  totalQuantity: number;
  taxableValue: number;
  integratedTax: number;
  centralTax: number;
  stateTax: number;
  cess: number;
  totalTax: number;
}

export interface GSTR1B2BInvoice {
  gstin: string;
  partyName: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  placeOfSupply: string;
  reverseCharge: boolean;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface GSTR1B2CSummary {
  supplyType: 'intra' | 'inter';
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface GSTR1Summary {
  period: string;
  b2b: GSTR1B2BInvoice[];
  b2c: GSTR1B2CSummary[];
  totals: {
    taxableValue: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    invoiceCount: number;
  };
}

export interface GSTR3BSummary {
  period: string;
  outwardSupplies: {
    taxableValue: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  };
  itcAvailable: {
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  };
  netPayable: {
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    total: number;
  };
}

export interface GSTLiability {
  period: string;
  outwardTax: number;
  itcAvailable: number;
  netPayable: number;
}

/* ------------------------------ Expenses — Phase 15 ------------------------------ */

export interface ExpenseCategory {
  _id: string;
  hsnCode?: string;
  name: string;
  description: string;
  accountId: string | null;
  systemKey: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Expense {
  _id: string;
  documentNumber: string;
  categoryId: string | { _id: string; name: string };
  categoryName: string;
  accountId: string | null;
  amount: number;
  date: string;
  paymentMode: string;
  description: string;
  referenceNumber: string | null;
  journalEntryId: string | null;
  status: 'Draft' | 'Posted';
  isRecurring: boolean;
  recurrenceFrequency: 'daily' | 'weekly' | 'monthly' | 'yearly' | null;
  nextDueDate: string | null;
  parentExpenseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseSummaryCategory {
  _id: string;
  total: number;
  count: number;
}

export interface ExpenseSummary {
  categories: ExpenseSummaryCategory[];
  grandTotal: number;
}

/* ------------------------------ Banking — Phase 15 ------------------------------ */

export interface BankAccount {
  _id: string;
  accountName: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string | null;
  branchName: string | null;
  openingBalance: number;
  currentBalance: number;
  currency: string;
  accountId: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export type TransactionMode =
  | 'NEFT' | 'RTGS' | 'IMPS' | 'UPI' | 'Cheque'
  | 'Cash' | 'DD' | 'DirectDebit' | 'Interest' | 'Charges' | 'Other';

export type TransactionStatus = 'Pending' | 'Cleared' | 'Bounced';

export interface BankTransaction {
  _id: string;
  bankAccountId: string;
  transactionDate: string;
  valueDate: string | null;
  amount: number;
  type: 'Credit' | 'Debit';
  mode: TransactionMode;
  referenceNumber: string | null;
  chequeNumber: string | null;
  description: string;
  status: TransactionStatus;
  statementEntryId: string | null;
  reconciledAt: string | null;
  journalEntryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BankStatementEntry {
  _id: string;
  bankAccountId: string;
  importBatch: string;
  statementDate: string;
  description: string;
  referenceNumber: string | null;
  credit: number;
  debit: number;
  balance: number | null;
  isMatched: boolean;
  matchedTransactionId: string | null;
  matchedAt: string | null;
}

export interface ReconciliationData {
  statements: BankStatementEntry[];
  transactions: BankTransaction[];
  unmatched: {
    statements: BankStatementEntry[];
    transactions: BankTransaction[];
  };
}

export interface ImportBatch {
  _id: string;
  count: number;
  matched: number;
  minDate: string;
  maxDate: string;
}
