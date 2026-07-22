import { CustomerModel } from '../models/Customer.js';
import { seedOpeningBalance } from './customerLedger.service.js';
import {
  buildTemplate as buildTemplateFor,
  runImport,
  EMAIL_RE,
  GST_RE,
  PAN_RE,
  PHONE_RE,
  type ColumnSpec,
  type ImportResult,
  type ImportSpec,
  type RowContext,
} from './excelImport.service.js';
import { tenantFilter, tenantStamp, type TenantContext } from '../middlewares/tenantScope.js';

export type { ImportResult, ImportRowError } from './excelImport.service.js';

/**
 * Customer bulk import. The mechanics — template rendering, header matching,
 * uniqueness, dry runs, the per-row error report — live in
 * excelImport.service.ts, shared with suppliers. This file is the column list
 * and the per-row validation, which is all that actually differs.
 */

const COLUMNS: ColumnSpec[] = [
  { header: 'Name*', key: 'name', width: 28, note: 'Required' },
  { header: 'Phone*', key: 'phone', width: 16, note: 'Required, unique per company' },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'GST Number', key: 'gstNumber', width: 20 },
  { header: 'PAN', key: 'pan', width: 14 },
  { header: 'Credit Limit', key: 'creditLimit', width: 14 },
  { header: 'Opening Balance', key: 'openingBalance', width: 16, note: 'Positive = owes you' },
  { header: 'Billing Line 1', key: 'billingLine1', width: 28 },
  { header: 'Billing Line 2', key: 'billingLine2', width: 28 },
  { header: 'Billing City', key: 'billingCity', width: 18 },
  { header: 'Billing State', key: 'billingState', width: 18 },
  { header: 'Billing Pincode', key: 'billingPincode', width: 14 },
  { header: 'Shipping Line 1', key: 'shippingLine1', width: 28 },
  { header: 'Shipping Line 2', key: 'shippingLine2', width: 28 },
  { header: 'Shipping City', key: 'shippingCity', width: 18 },
  { header: 'Shipping State', key: 'shippingState', width: 18 },
  { header: 'Shipping Pincode', key: 'shippingPincode', width: 14 },
];

function validateRow(ctx: RowContext) {
  const name = ctx.text('Name');
  const phone = ctx.text('Phone').replace(/[\s-]/g, '');

  if (!name) return 'Name is required';
  if (!phone) return 'Phone is required';
  if (!PHONE_RE.test(phone)) return `Phone "${phone}" is not a valid number (7–15 digits)`;

  const email = ctx.text('Email').toLowerCase();
  if (email && !EMAIL_RE.test(email)) return `"${email}" is not a valid email address`;

  const gstNumber = ctx.text('GST Number').toUpperCase();
  if (gstNumber && !GST_RE.test(gstNumber)) {
    return `"${gstNumber}" is not a valid 15-character GSTIN`;
  }

  const pan = ctx.text('PAN').toUpperCase();
  if (pan && !PAN_RE.test(pan)) return `"${pan}" is not a valid PAN`;

  const creditLimit = ctx.number('Credit Limit');
  if (creditLimit !== null && creditLimit < 0) return 'Credit Limit cannot be negative';

  const opening = ctx.number('Opening Balance') ?? 0;

  return {
    opening,
    doc: {
      name,
      phone,
      ...(email && { email }),
      ...(gstNumber && { gstNumber }),
      ...(pan && { pan }),
      creditLimit: creditLimit ?? 0,
      openingBalance: opening,
      currentBalance: 0,
      billingAddress: {
        line1: ctx.text('Billing Line 1') || undefined,
        line2: ctx.text('Billing Line 2') || undefined,
        city: ctx.text('Billing City') || undefined,
        state: ctx.text('Billing State') || undefined,
        pincode: ctx.text('Billing Pincode') || undefined,
      },
      shippingAddress: {
        line1: ctx.text('Shipping Line 1') || undefined,
        line2: ctx.text('Shipping Line 2') || undefined,
        city: ctx.text('Shipping City') || undefined,
        state: ctx.text('Shipping State') || undefined,
        pincode: ctx.text('Shipping Pincode') || undefined,
      },
    },
  };
}

const SPEC: ImportSpec = {
  sheetName: 'Customers',
  columns: COLUMNS,
  requiredHeaders: ['Name', 'Phone'],
  uniqueHeader: 'Phone',
  uniqueLabel: 'customer',
  // Sheets write "98765-43210" for what we store as "9876543210".
  normalizeUnique: (raw) => raw.replace(/[\s-]/g, ''),
  templateTitle: 'Khatavala — customer import template',
  templateNotes: [
    'Fill in the "Customers" sheet, one customer per row, then upload it.',
    'Row 2 is a sample — replace or delete it.',
    '',
    'Name and Phone are required. Every other column may be left blank.',
    'Phone must be unique within your company; rows whose phone already exists are reported as errors and skipped.',
    'Opening Balance: positive if the customer owes you, negative if they have paid you in advance.',
    'Credit Limit and Opening Balance must be plain numbers — no currency symbols or thousands separators.',
    'Do not rename, reorder or remove the header row; columns are matched by header name.',
  ],
  sampleRow: {
    name: 'Sample Traders',
    phone: '9876543210',
    email: 'accounts@sampletraders.example',
    gstNumber: '27AAPFU0939F1ZV',
    pan: 'AAPFU0939F',
    creditLimit: 50000,
    openingBalance: 12500,
    billingLine1: '12 Market Road',
    billingCity: 'Pune',
    billingState: 'Maharashtra',
    billingPincode: '411001',
  },
  validateRow,
  loadTakenKeys: async (tenant) => {
    const existing = await CustomerModel.find(tenantFilter(tenant, {})).select('phone').lean();
    return new Set(existing.map((c) => c.phone));
  },
  writeRow: async (tenant, doc, opening) => {
    const customer = await CustomerModel.create(tenantStamp(tenant, doc));
    // Opening balances go through the ledger writer, so an imported customer
    // has the same first-entry history as a hand-created one.
    await seedOpeningBalance(tenant, customer._id, opening);
  },
};

export function buildTemplate(): Promise<Buffer> {
  return buildTemplateFor(SPEC);
}

export function importCustomers(
  tenant: TenantContext,
  fileBuffer: Buffer,
  options: { dryRun?: boolean } = {}
): Promise<ImportResult> {
  return runImport(tenant, fileBuffer, SPEC, options);
}
