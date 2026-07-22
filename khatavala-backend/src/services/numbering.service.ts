import type { ClientSession } from 'mongoose';
import { CounterModel } from '../models/Counter.js';
import type { TenantContext } from '../middlewares/tenantScope.js';

/**
 * Document numbering. See the header of models/Counter.ts for why this is a
 * counter collection and not `count() + 1`.
 */

export interface NumberingConfig {
  /** Counter key, e.g. 'SalesInvoice'. */
  key: string;
  /** Printed prefix, e.g. 'INV'. */
  prefix: string;
  /** Zero-padding width for the sequence. */
  width?: number;
}

/**
 * The Indian financial year containing `date`, as "2026-27".
 *
 * Uses the company's `financialYearStart` month (April by default, already on
 * the Company model since Phase 2) so a company on a different cycle numbers
 * correctly. A date before the start month belongs to the year that began the
 * previous calendar year.
 */
export function financialYearOf(date: Date, startMonth = 4): string {
  const month = date.getMonth() + 1; // getMonth is 0-indexed
  const startYear = month >= startMonth ? date.getFullYear() : date.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Allocates the next number in a series and returns it formatted.
 *
 * MUST be called with the session of the transaction that creates the document.
 * Allocating outside the transaction would leave a gap in the series whenever
 * that transaction aborts, and a GST invoice series must be consecutive.
 */
export async function nextDocumentNumber(
  tenant: TenantContext,
  config: NumberingConfig,
  options: { session?: ClientSession; date?: Date; financialYearStart?: number } = {}
): Promise<string> {
  const date = options.date ?? new Date();
  const period = financialYearOf(date, options.financialYearStart ?? 4);

  const counter = await CounterModel.findOneAndUpdate(
    { companyId: tenant.companyId, key: config.key, period },
    { $inc: { sequence: 1 } },
    {
      new: true,
      upsert: true,
      ...(options.session ? { session: options.session } : {}),
    }
  );

  const sequence = String(counter.sequence).padStart(config.width ?? 4, '0');
  return `${config.prefix}-${period}-${sequence}`;
}

/**
 * Reads the next number WITHOUT consuming it, for a "your invoice will be
 * numbered…" preview. Explicitly not a reservation: by the time the user
 * submits, someone else may have taken it. The UI must treat it as a hint.
 */
export async function peekDocumentNumber(
  tenant: TenantContext,
  config: NumberingConfig,
  date = new Date(),
  financialYearStart = 4
): Promise<string> {
  const period = financialYearOf(date, financialYearStart);
  const counter = await CounterModel.findOne({
    companyId: tenant.companyId,
    key: config.key,
    period,
  }).lean();

  const sequence = String((counter?.sequence ?? 0) + 1).padStart(config.width ?? 4, '0');
  return `${config.prefix}-${period}-${sequence}`;
}
