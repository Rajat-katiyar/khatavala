import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { CompanyModel } from '../models/Company.js';
import * as reports from './reports.service.js';
import type { TenantContext } from '../middlewares/tenantScope.js';

/**
 * REPORT EXPORT — one PDF renderer and one Excel renderer, for all four
 * statements.
 *
 * The reports differ in what they contain, not in how they print: a title, a
 * period, some sections of labelled rows, and totals. So each report is
 * flattened into the `ReportDocument` shape below and handed to a single
 * renderer per format. Eight bespoke renderers would be eight places to fix the
 * next column-alignment bug.
 *
 * PDFKit rather than Puppeteer, for the reason given in invoicePdf.service:
 * shipping a headless Chromium to lay out a fixed A4 table is the wrong trade.
 * Amounts print `Rs.` because PDFKit's built-in Helvetica has no rupee glyph and
 * renders it as an empty box.
 */

export type ReportFormat = 'pdf' | 'xlsx';

export type ReportKind =
  | 'trial-balance'
  | 'profit-loss'
  | 'balance-sheet'
  | 'day-book';

interface ReportColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  /** Rendered as money. Everything else prints as-is. */
  money?: boolean;
  width: number;
}

interface ReportRow {
  [key: string]: string | number | null | undefined;
  /** Renders bold with a rule above — section totals and the bottom line. */
  __emphasis?: 0 | 1;
  /** Indents the first column, for nested statement lines. */
  __indent?: 0 | 1;
}

interface ReportSection {
  title?: string;
  rows: ReportRow[];
}

interface ReportDocument {
  title: string;
  companyName: string;
  periodLabel: string;
  columns: ReportColumn[];
  sections: ReportSection[];
  /** Printed under the table — the balance checks and headline figures. */
  summary: { label: string; value: string }[];
  fileBase: string;
}

const money = (amount: number): string =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

const formatDate = (value: Date | string | null | undefined): string =>
  value
    ? new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(value))
    : '—';

const periodLabel = (from?: Date | null, to?: Date | null): string => {
  if (from && to) return `${formatDate(from)} to ${formatDate(to)}`;
  if (to) return `As at ${formatDate(to)}`;
  if (from) return `From ${formatDate(from)}`;
  return 'All time';
};

/* ------------------------------------------------------------------ *
 * Report → ReportDocument
 * ------------------------------------------------------------------ */

async function buildDocument(
  tenant: TenantContext,
  kind: ReportKind,
  query: { from?: Date; to?: Date; date?: Date }
): Promise<ReportDocument> {
  const company = await CompanyModel.findById(tenant.companyId).select('name').lean();
  const companyName = company?.name ?? 'Khatavala';

  if (kind === 'trial-balance') {
    const report = await reports.getTrialBalance(tenant, query);
    return {
      title: 'Trial Balance',
      companyName,
      periodLabel: periodLabel(query.from, query.to),
      fileBase: 'trial-balance',
      columns: [
        { key: 'code', label: 'Code', width: 55 },
        { key: 'accountName', label: 'Account', width: 200 },
        { key: 'accountType', label: 'Type', width: 80 },
        { key: 'debit', label: 'Debit', align: 'right', money: true, width: 88 },
        { key: 'credit', label: 'Credit', align: 'right', money: true, width: 88 },
      ],
      sections: [
        {
          rows: [
            ...report.accounts.map((account) => ({
              code: account.code ?? '',
              accountName: account.accountName,
              accountType: account.accountType,
              debit: account.debit,
              credit: account.credit,
            })),
            {
              code: '',
              accountName: 'TOTAL',
              accountType: '',
              debit: report.totals.debit,
              credit: report.totals.credit,
              __emphasis: 1 as const,
            },
          ],
        },
      ],
      summary: [
        { label: 'Total debits', value: money(report.totals.debit) },
        { label: 'Total credits', value: money(report.totals.credit) },
        {
          label: 'Difference',
          value: `${money(report.totals.difference)} — ${
            report.totals.balanced ? 'BALANCED' : 'OUT OF BALANCE'
          }`,
        },
      ],
    };
  }

  if (kind === 'profit-loss') {
    const report = await reports.getProfitAndLoss(tenant, query);
    const section = (
      title: string,
      lines: { accountName: string; amount: number }[],
      totalLabel: string,
      total: number
    ): ReportSection => ({
      title,
      rows: [
        ...lines.map((line) => ({
          particulars: line.accountName,
          amount: line.amount,
          __indent: 1 as const,
        })),
        { particulars: totalLabel, amount: total, __emphasis: 1 as const },
      ],
    });

    return {
      title: 'Profit & Loss Statement',
      companyName,
      periodLabel: periodLabel(query.from, query.to),
      fileBase: 'profit-and-loss',
      columns: [
        { key: 'particulars', label: 'Particulars', width: 330 },
        { key: 'amount', label: 'Amount', align: 'right', money: true, width: 130 },
      ],
      sections: [
        section('Revenue', report.sections.revenue.lines, 'Net revenue', report.totals.netRevenue),
        section(
          'Cost of sales',
          report.sections.costOfSales.lines,
          'Total cost of sales',
          report.totals.costOfSales
        ),
        { rows: [{ particulars: 'GROSS PROFIT', amount: report.totals.grossProfit, __emphasis: 1 }] },
        ...(report.sections.otherIncome.lines.length > 0
          ? [
              section(
                'Other income',
                report.sections.otherIncome.lines,
                'Total other income',
                report.totals.otherIncome
              ),
            ]
          : []),
        section(
          'Expenses',
          report.sections.expenses.lines,
          'Total expenses',
          report.totals.expenses
        ),
        { rows: [{ particulars: 'NET PROFIT', amount: report.totals.netProfit, __emphasis: 1 }] },
      ],
      summary: [
        { label: 'Gross profit', value: money(report.totals.grossProfit) },
        { label: 'Net profit', value: money(report.totals.netProfit) },
        {
          label: 'Net margin',
          value:
            report.totals.netMarginPercent === null
              ? 'n/a'
              : `${report.totals.netMarginPercent}%`,
        },
      ],
    };
  }

  if (kind === 'balance-sheet') {
    const report = await reports.getBalanceSheet(tenant, query.to ?? query.date);
    const section = (
      title: string,
      lines: { accountName: string; amount: number }[],
      totalLabel: string,
      total: number,
      extra: ReportRow[] = []
    ): ReportSection => ({
      title,
      rows: [
        ...lines.map((line) => ({
          particulars: line.accountName,
          amount: line.amount,
          __indent: 1 as const,
        })),
        ...extra,
        { particulars: totalLabel, amount: total, __emphasis: 1 as const },
      ],
    });

    return {
      title: 'Balance Sheet',
      companyName,
      periodLabel: periodLabel(null, query.to ?? query.date ?? new Date()),
      fileBase: 'balance-sheet',
      columns: [
        { key: 'particulars', label: 'Particulars', width: 330 },
        { key: 'amount', label: 'Amount', align: 'right', money: true, width: 130 },
      ],
      sections: [
        section(
          'Assets',
          report.sections.assets.lines,
          'Total assets',
          report.totals.assets
        ),
        section(
          'Liabilities',
          report.sections.liabilities.lines,
          'Total liabilities',
          report.totals.liabilities
        ),
        section(
          'Equity',
          report.sections.equity.lines,
          'Total equity',
          report.totals.equity,
          [
            {
              particulars: report.sections.equity.retainedEarnings.accountName,
              amount: report.sections.equity.retainedEarnings.amount,
              __indent: 1 as const,
            },
          ]
        ),
        {
          rows: [
            {
              particulars: 'TOTAL LIABILITIES AND EQUITY',
              amount: report.totals.liabilitiesAndEquity,
              __emphasis: 1,
            },
          ],
        },
      ],
      summary: [
        { label: 'Total assets', value: money(report.totals.assets) },
        {
          label: 'Liabilities + equity',
          value: money(report.totals.liabilitiesAndEquity),
        },
        {
          label: 'Difference',
          value: `${money(report.totals.difference)} — ${
            report.totals.balanced ? 'BALANCED' : 'OUT OF BALANCE'
          }`,
        },
      ],
    };
  }

  const report = await reports.getDayBook(tenant, query);
  return {
    title: 'Day Book',
    companyName,
    periodLabel: periodLabel(report.period.from, report.period.to),
    fileBase: 'day-book',
    columns: [
      { key: 'documentNumber', label: 'Entry', width: 90 },
      { key: 'date', label: 'Date', width: 75 },
      { key: 'particulars', label: 'Particulars', width: 205 },
      { key: 'debit', label: 'Debit', align: 'right', money: true, width: 70 },
      { key: 'credit', label: 'Credit', align: 'right', money: true, width: 70 },
    ],
    sections: [
      {
        rows: [
          // One row per LINE, grouped under the entry that owns it: a day book
          // is read as transactions, and the account breakdown is the point.
          ...report.entries.flatMap((entry) => [
            {
              documentNumber: entry.documentNumber,
              date: formatDate(entry.date),
              particulars: entry.narration ?? entry.sourceNumber ?? entry.sourceType,
              debit: '' as const,
              credit: '' as const,
            },
            ...entry.lines.map((line: any) => ({
              documentNumber: '',
              date: '',
              particulars: line.accountName,
              debit: line.debitAmount || ('' as const),
              credit: line.creditAmount || ('' as const),
              __indent: 1 as const,
            })),
          ]),
          {
            documentNumber: '',
            date: '',
            particulars: 'TOTAL',
            debit: report.totals.debit,
            credit: report.totals.credit,
            __emphasis: 1 as const,
          },
        ],
      },
    ],
    summary: [
      { label: 'Entries', value: String(report.totals.entries) },
      { label: 'Total debits', value: money(report.totals.debit) },
      { label: 'Total credits', value: money(report.totals.credit) },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */

const MARGIN = 40;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function renderPdf(document: ReportDocument): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  doc.fontSize(15).font('Helvetica-Bold').text(document.companyName, MARGIN, MARGIN);
  doc.fontSize(13).text(document.title, { continued: false });
  doc.fontSize(9).font('Helvetica').fillColor('#555').text(document.periodLabel);

  let y = doc.y + 12;

  const drawHeader = () => {
    doc.rect(MARGIN, y, CONTENT_WIDTH, 18).fill('#eef2f7');
    doc.fillColor('#000').fontSize(8.5).font('Helvetica-Bold');
    let x = MARGIN;
    for (const column of document.columns) {
      doc.text(column.label, x + 4, y + 5, {
        width: column.width - 8,
        align: column.align ?? 'left',
      });
      x += column.width;
    }
    y += 18;
    doc.font('Helvetica').fontSize(8.5);
  };

  drawHeader();

  for (const section of document.sections) {
    if (section.title) {
      // Page break BEFORE a heading rather than after, so a section title never
      // ends up alone at the foot of a page.
      if (y > 740) {
        doc.addPage();
        y = MARGIN;
        drawHeader();
      }
      y += 6;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
      doc.text(section.title.toUpperCase(), MARGIN + 2, y);
      y += 14;
      doc.font('Helvetica').fontSize(8.5);
    }

    for (const row of section.rows) {
      if (y > 780) {
        doc.addPage();
        y = MARGIN;
        drawHeader();
      }

      const emphasis = row.__emphasis === 1;
      if (emphasis) {
        doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#94a3b8').stroke();
        y += 3;
        doc.font('Helvetica-Bold');
      }

      let x = MARGIN;
      document.columns.forEach((column, index) => {
        const raw = row[column.key];
        const text =
          raw === null || raw === undefined || raw === ''
            ? ''
            : column.money && typeof raw === 'number'
              ? money(raw)
              : String(raw);
        const indent = index === 0 && row.__indent === 1 ? 10 : 0;
        doc.fillColor('#000').text(text, x + 4 + indent, y + 3, {
          width: column.width - 8 - indent,
          align: column.align ?? 'left',
        });
        x += column.width;
      });

      y += emphasis ? 16 : 13;
      if (emphasis) doc.font('Helvetica');
    }
  }

  y += 14;
  if (y > 720) {
    doc.addPage();
    y = MARGIN;
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Summary', MARGIN, y);
  y += 14;
  doc.font('Helvetica').fontSize(8.5).fillColor('#333');
  for (const item of document.summary) {
    doc.text(item.label, MARGIN + 4, y, { width: 200 });
    doc.text(item.value, MARGIN + 204, y, { width: 200, align: 'right' });
    y += 13;
  }

  /**
   * The footer sits inside the bottom margin, computed rather than hard-coded.
   *
   * A fixed y of 800 put the baseline below the usable area (page height less
   * the 40pt margin), so PDFKit flowed it onto a fresh page and every exported
   * report ended with a blank second sheet. `lineGap`/`height` are subtracted
   * so the text FITS rather than merely starting inside the boundary.
   */
  doc
    .fontSize(7.5)
    .fillColor('#94a3b8')
    .text(
      'Generated by Khatavala. Figures are derived from posted journal entries.',
      MARGIN,
      doc.page.height - MARGIN - 10,
      { width: CONTENT_WIDTH, align: 'center', lineBreak: false }
    );

  doc.end();
  return done;
}

/* ------------------------------------------------------------------ *
 * Excel
 * ------------------------------------------------------------------ */

async function renderExcel(document: ReportDocument): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Khatavala';
  const sheet = workbook.addWorksheet(document.title.slice(0, 31));

  sheet.columns = document.columns.map((column) => ({
    key: column.key,
    // Excel column width is in characters, not points; the /5.5 keeps the sheet
    // roughly proportional to the PDF without hand-tuning every report.
    width: Math.max(10, Math.round(column.width / 5.5)),
  }));

  const titleRow = sheet.addRow([document.companyName]);
  titleRow.font = { bold: true, size: 14 };
  sheet.addRow([document.title]).font = { bold: true, size: 12 };
  sheet.addRow([document.periodLabel]).font = { italic: true, color: { argb: 'FF555555' } };
  sheet.addRow([]);

  const header = sheet.addRow(document.columns.map((column) => column.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FF94A3B8' } } };
  });

  for (const section of document.sections) {
    if (section.title) {
      const sectionRow = sheet.addRow([section.title.toUpperCase()]);
      sectionRow.font = { bold: true };
    }

    for (const row of section.rows) {
      const values = document.columns.map((column, index) => {
        const raw = row[column.key];
        if (raw === null || raw === undefined || raw === '') return null;
        // Money stays a NUMBER in Excel, formatted by the cell — exporting it
        // as text would make the one thing people open Excel to do (add a
        // column up) impossible.
        if (column.money && typeof raw === 'number') return raw;
        return index === 0 && row.__indent === 1 ? `    ${raw}` : raw;
      });

      const added = sheet.addRow(values);
      document.columns.forEach((column, index) => {
        const cell = added.getCell(index + 1);
        if (column.money) cell.numFmt = '#,##0.00';
        if (column.align === 'right') cell.alignment = { horizontal: 'right' };
      });

      if (row.__emphasis === 1) {
        added.font = { bold: true };
        added.eachCell((cell) => {
          cell.border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } } };
        });
      }
    }
  }

  sheet.addRow([]);
  sheet.addRow(['Summary']).font = { bold: true };
  for (const item of document.summary) {
    sheet.addRow([item.label, item.value]);
  }

  // ExcelJS types this as the DOM's ArrayBuffer-ish; Buffer.from normalises it.
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

/* ------------------------------------------------------------------ *
 * Public
 * ------------------------------------------------------------------ */

export async function exportReport(
  tenant: TenantContext,
  kind: ReportKind,
  format: ReportFormat,
  query: { from?: Date; to?: Date; date?: Date } = {}
): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
  const document = await buildDocument(tenant, kind, query);

  if (format === 'xlsx') {
    return {
      buffer: await renderExcel(document),
      fileName: `${document.fileBase}.xlsx`,
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  return {
    buffer: await renderPdf(document),
    fileName: `${document.fileBase}.pdf`,
    contentType: 'application/pdf',
  };
}
