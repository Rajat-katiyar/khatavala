import { SupplierModel } from '../models/Supplier.js';
import { seedOpeningBalance } from './supplierLedger.service.js';
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
 * Supplier bulk import — the same engine as customers (excelImport.service.ts),
 * differing only in columns and per-row validation.
 *
 * One field is genuinely different in meaning, not just in name: Opening
 * Balance here is what WE OWE THEM, the opposite direction to the customer
 * template. The template notes say so in those words, because a migration that
 * gets this backwards produces books that look plausible and are wrong.
 */

const COLUMNS: ColumnSpec[] = [
  { header: 'Name*', key: 'name', width: 28, note: 'Required' },
  { header: 'Phone*', key: 'phone', width: 16, note: 'Required, unique per company' },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'GST Number', key: 'gstNumber', width: 20 },
  { header: 'PAN', key: 'pan', width: 14 },
  {
    header: 'Opening Balance',
    key: 'openingBalance',
    width: 16,
    note: 'Positive = you owe them',
  },
  { header: 'Vendor Rating', key: 'vendorRating', width: 14, note: '1 to 5, optional' },
  { header: 'Address Line 1', key: 'line1', width: 28 },
  { header: 'Address Line 2', key: 'line2', width: 28 },
  { header: 'City', key: 'city', width: 18 },
  { header: 'State', key: 'state', width: 18 },
  { header: 'Pincode', key: 'pincode', width: 14 },
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

  const rating = ctx.number('Vendor Rating');
  if (rating !== null && (rating < 1 || rating > 5 || !Number.isInteger(rating))) {
    return `Vendor Rating "${ctx.text('Vendor Rating')}" must be a whole number from 1 to 5`;
  }

  const opening = ctx.number('Opening Balance') ?? 0;

  return {
    opening,
    doc: {
      name,
      phone,
      ...(email && { email }),
      ...(gstNumber && { gstNumber }),
      ...(pan && { pan }),
      vendorRating: rating,
      openingBalance: opening,
      currentBalance: 0,
      address: {
        line1: ctx.text('Address Line 1') || undefined,
        line2: ctx.text('Address Line 2') || undefined,
        city: ctx.text('City') || undefined,
        state: ctx.text('State') || undefined,
        pincode: ctx.text('Pincode') || undefined,
      },
    },
  };
}

const SPEC: ImportSpec = {
  sheetName: 'Suppliers',
  columns: COLUMNS,
  requiredHeaders: ['Name', 'Phone'],
  uniqueHeader: 'Phone',
  uniqueLabel: 'supplier',
  // Sheets write "98765-43210" for what we store as "9876543210".
  normalizeUnique: (raw) => raw.replace(/[\s-]/g, ''),
  templateTitle: 'Khatavala — supplier import template',
  templateNotes: [
    'Fill in the "Suppliers" sheet, one supplier per row, then upload it.',
    'Row 2 is a sample — replace or delete it.',
    '',
    'Name and Phone are required. Every other column may be left blank.',
    'Phone must be unique within your company; rows whose phone already exists are reported as errors and skipped.',
    'Opening Balance: positive if YOU OWE THEM, negative if you have already paid them in advance.',
    'Note this is the opposite direction to the customer template — here a positive number is money going out.',
    'Vendor Rating is an optional whole number from 1 to 5.',
    'Opening Balance must be a plain number — no currency symbols or thousands separators.',
    'Do not rename, reorder or remove the header row; columns are matched by header name.',
  ],
  sampleRow: {
    name: 'Sample Suppliers Pvt Ltd',
    phone: '9812345670',
    email: 'accounts@samplesuppliers.example',
    gstNumber: '27AAPFU0939F1ZV',
    pan: 'AAPFU0939F',
    openingBalance: 32000,
    vendorRating: 4,
    line1: '44 Industrial Estate',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411019',
  },
  validateRow,
  loadTakenKeys: async (tenant) => {
    const existing = await SupplierModel.find(tenantFilter(tenant, {})).select('phone').lean();
    return new Set(existing.map((s) => s.phone));
  },
  writeRow: async (tenant, doc, opening) => {
    const supplier = await SupplierModel.create(tenantStamp(tenant, doc));
    // Opening balances go through the ledger writer, so an imported supplier
    // has the same first-entry history as a hand-created one.
    await seedOpeningBalance(tenant, supplier._id, opening);
  },
};

export function buildTemplate(): Promise<Buffer> {
  return buildTemplateFor(SPEC);
}

export function importSuppliers(
  tenant: TenantContext,
  fileBuffer: Buffer,
  options: { dryRun?: boolean } = {}
): Promise<ImportResult> {
  return runImport(tenant, fileBuffer, SPEC, options);
}
