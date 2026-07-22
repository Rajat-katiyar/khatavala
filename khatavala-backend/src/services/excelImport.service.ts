import ExcelJS from 'exceljs';
import { ApiError } from '../utils/ApiError.js';
import type { TenantContext } from '../middlewares/tenantScope.js';

/**
 * SHARED EXCEL IMPORT ENGINE
 * ==========================
 * Customers and suppliers import from structurally identical spreadsheets:
 * a header row matched by NAME, one party per row, validate-then-write, and a
 * per-row error report. Only the column list and the per-row validation differ,
 * so those are the parameters and everything else lives here once.
 *
 * The contract with the user is: either a row imports cleanly, or it is
 * reported back with its row number and the reason. Nothing is half-written and
 * no row is silently skipped — an import that quietly drops 12 of 300 rows is
 * worse than one that fails outright, because nobody notices until the balances
 * don't tie out.
 */

export interface ColumnSpec {
  header: string;
  key: string;
  width: number;
  note?: string;
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

/** Reads a cell into a trimmed string, tolerating formulas, links and numbers. */
export function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return '';
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value) return String(value.result ?? '').trim();
    if ('richText' in value) {
      return value.richText.map((part) => part.text).join('').trim();
    }
    if (value instanceof Date) return value.toISOString();
  }
  return String(value).trim();
}

/**
 * Parses a money cell. Accepts what people actually paste from their old
 * books — "₹1,25,000", "1,250.50", "(500)" for negatives — rather than
 * rejecting the whole row over formatting.
 */
export function cellNumber(cell: ExcelJS.Cell | undefined): number | null {
  const raw = cellText(cell);
  if (!raw) return null;
  const negated = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[()]/g, '').replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return negated ? -Math.abs(parsed) : parsed;
}

export const PHONE_RE = /^[0-9]{7,15}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z][Z][0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** What a row validator gets: a header-name cell reader plus its row number. */
export interface RowContext {
  row: number;
  get: (header: string) => ExcelJS.Cell | undefined;
  text: (header: string) => string;
  number: (header: string) => number | null;
}

/** A validator returns the document to write, or a string describing the problem. */
export type RowValidator = (
  ctx: RowContext
) => { doc: Record<string, unknown>; opening: number } | string;

export interface ImportSpec {
  sheetName: string;
  columns: ColumnSpec[];
  /** Headers that must be present, or the whole upload is rejected. */
  requiredHeaders: string[];
  templateTitle: string;
  templateNotes: string[];
  sampleRow: Record<string, unknown>;
  validateRow: RowValidator;
  /** Persists one accepted row. Runs only when not a dry run. */
  writeRow: (
    tenant: TenantContext,
    doc: Record<string, unknown>,
    opening: number
  ) => Promise<void>;
  /**
   * Values of the uniqueness field already taken in this company, plus the
   * header the value comes from. Fetched once rather than queried per row: a
   * 500-row import would otherwise be 500 round trips to Atlas.
   */
  loadTakenKeys: (tenant: TenantContext) => Promise<Set<string>>;
  uniqueHeader: string;
  uniqueLabel: string;
  /**
   * Normalises the uniqueness value before comparing it to `loadTakenKeys`.
   *
   * This MUST match however the writer stores the field. Phone numbers are
   * compared with spaces and hyphens stripped, because a sheet writes
   * "98765-43210" for what we store as "9876543210". SKUs are the opposite:
   * hyphens are significant, and stripping them made "RICE-BAS-5KG" compare as
   * "RICEBAS5KG" — which matched nothing, so every already-existing product
   * imported again as a duplicate. Defaults to identity.
   */
  normalizeUnique?: (raw: string) => string;
}

/** Builds the blank template, with one example row people can overwrite. */
export async function buildTemplate(spec: ImportSpec): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Khatavala';
  const sheet = workbook.addWorksheet(spec.sheetName);

  sheet.columns = spec.columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF7' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  spec.columns.forEach((column, index) => {
    if (column.note) header.getCell(index + 1).note = column.note;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  // A sample row. Marked in grey and called out in the notes sheet so it is
  // obviously an example — importing it unchanged is harmless (it is a valid
  // row) but the user should replace it.
  const sample = sheet.addRow(spec.sampleRow);
  sample.font = { color: { argb: 'FF9AA0A6' }, italic: true };

  const notes = workbook.addWorksheet('Instructions');
  notes.columns = [{ width: 100 }];
  [spec.templateTitle, '', ...spec.templateNotes].forEach((line, index) => {
    const row = notes.addRow([line]);
    if (index === 0) row.font = { bold: true, size: 14 };
  });

  // ExcelJS types this as the DOM's ArrayBuffer-ish; Buffer.from normalises it.
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/**
 * Imports parties from an uploaded workbook.
 *
 * @param dryRun validate and report without writing — lets the UI preview an
 *   import before committing to it.
 */
export async function runImport(
  tenant: TenantContext,
  fileBuffer: Buffer,
  spec: ImportSpec,
  options: { dryRun?: boolean } = {}
): Promise<ImportResult> {
  const dryRun = options.dryRun ?? false;

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(fileBuffer as unknown as ArrayBuffer);
  } catch {
    throw ApiError.badRequest('That file could not be read as an .xlsx workbook');
  }

  const sheet = workbook.getWorksheet(spec.sheetName) ?? workbook.worksheets[0];
  if (!sheet) throw ApiError.badRequest('The workbook has no sheets');

  // Columns are matched by header text, not position, so a user who inserts a
  // column of their own notes does not shift every field by one.
  const headerRow = sheet.getRow(1);
  const headerToIndex = new Map<string, number>();
  headerRow.eachCell((cell, colNumber) => {
    const key = cellText(cell).replace(/\*$/, '').trim().toLowerCase();
    if (key) headerToIndex.set(key, colNumber);
  });

  const indexOf = (header: string) =>
    headerToIndex.get(header.replace(/\*$/, '').trim().toLowerCase());

  const missing = spec.requiredHeaders.filter((h) => indexOf(h) === undefined);
  if (missing.length > 0) {
    throw ApiError.badRequest(
      `The sheet is missing required column(s): ${missing.join(', ')}. Download a fresh template.`
    );
  }

  const errors: ImportRowError[] = [];
  const pending: Array<{ row: number; doc: Record<string, unknown>; opening: number }> = [];

  const takenKeys = await spec.loadTakenKeys(tenant);

  // Duplicates *within the uploaded file* — the DB check above cannot catch two
  // rows in the same upload claiming the same key.
  const seenInFile = new Map<string, number>();

  let totalRows = 0;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const get = (header: string) => {
      const index = indexOf(header);
      return index === undefined ? undefined : row.getCell(index);
    };
    const text = (header: string) => cellText(get(header));
    const number = (header: string) => cellNumber(get(header));

    // A row where every known column is blank is trailing whitespace in the
    // sheet, not a mistake worth reporting.
    const anyValue = spec.columns.some((column) => text(column.header) !== '');
    if (!anyValue) return;

    totalRows += 1;

    const normalize = spec.normalizeUnique ?? ((raw: string) => raw);
    const uniqueValue = normalize(text(spec.uniqueHeader));
    const name = text('Name');
    const fail = (message: string) =>
      errors.push({ row: rowNumber, name, phone: uniqueValue, message });

    // Uniqueness is checked here rather than in each spec's validator, because
    // getting it wrong is how you get a partial import with duplicate parties.
    if (uniqueValue) {
      if (takenKeys.has(uniqueValue)) {
        return fail(`A ${spec.uniqueLabel} with ${spec.uniqueHeader.toLowerCase()} ${uniqueValue} already exists`);
      }
      if (seenInFile.has(uniqueValue)) {
        return fail(
          `${spec.uniqueHeader} ${uniqueValue} is repeated (also on row ${seenInFile.get(uniqueValue)})`
        );
      }
    }

    const outcome = spec.validateRow({ row: rowNumber, get, text, number });
    if (typeof outcome === 'string') return fail(outcome);

    if (uniqueValue) seenInFile.set(uniqueValue, rowNumber);
    pending.push({ row: rowNumber, doc: outcome.doc, opening: outcome.opening });
  });

  if (dryRun) {
    return { imported: pending.length, failed: errors.length, totalRows, errors, dryRun };
  }

  let imported = 0;
  for (const item of pending) {
    try {
      await spec.writeRow(tenant, item.doc, item.opening);
      imported += 1;
    } catch (err) {
      errors.push({
        row: item.row,
        name: String(item.doc.name ?? ''),
        phone: String(item.doc.phone ?? ''),
        message: err instanceof Error ? err.message : 'Could not save this row',
      });
    }
  }

  // Row order, so the report reads alongside the user's spreadsheet.
  errors.sort((a, b) => a.row - b.row);

  return { imported, failed: errors.length, totalRows, errors, dryRun };
}
