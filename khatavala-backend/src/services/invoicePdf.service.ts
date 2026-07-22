import PDFDocument from 'pdfkit';
import { CompanyModel } from '../models/Company.js';
import { CustomerModel } from '../models/Customer.js';
import { invoiceService } from './sales.service.js';
import { round2 } from './tradeDocument.factory.js';
import { tenantById, type TenantContext } from '../middlewares/tenantScope.js';

/**
 * Invoice PDF rendering.
 *
 * PDFKit rather than Puppeteer: Puppeteer means shipping a headless Chromium
 * (~300 MB) and keeping a browser process alive to lay out a document whose
 * layout is fixed and known. For a fixed A4 invoice that renders on a request
 * thread, drawing it directly is faster, has no runtime to crash, and does not
 * put a browser in the deployment. If invoice templates ever become
 * user-designed HTML, that trade flips.
 *
 * Streams into a Buffer rather than to disk: the PDF is generated per request
 * and sent, so a file would only add cleanup to get wrong.
 */

const MARGIN = 42;
const PAGE_WIDTH = 595.28; // A4 at 72dpi
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/**
 * Amounts print with a plain "Rs." rather than the ₹ glyph.
 *
 * PDFKit's built-in Helvetica is WinAnsi-encoded and has no rupee sign — it
 * renders as a blank box, which on an invoice looks like a rendering fault.
 * Fixing it properly means embedding a Unicode TTF, which is worth doing when
 * this module gets a font asset, and is not worth a broken glyph until then.
 */
const money = (amount: number): string =>
  `Rs. ${new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)}`;

const formatDate = (value: Date | string | null | undefined): string =>
  value
    ? new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(value))
    : '—';

const addressLines = (
  address: Record<string, string | null | undefined> | undefined
): string[] =>
  !address
    ? []
    : [
        address.line1,
        address.line2,
        [address.city, address.state].filter(Boolean).join(', '),
        address.pincode,
      ].filter((line): line is string => Boolean(line && line.trim()));

/** Column layout: [label, x offset, width, alignment]. */
const COLUMNS = [
  { key: 'index', label: '#', x: 0, width: 20, align: 'left' as const },
  { key: 'name', label: 'Item', x: 20, width: 130, align: 'left' as const },
  { key: 'hsn', label: 'HSN', x: 150, width: 45, align: 'left' as const },
  { key: 'qty', label: 'Qty', x: 195, width: 30, align: 'right' as const },
  { key: 'rate', label: 'Rate', x: 225, width: 52, align: 'right' as const },
  { key: 'disc', label: 'Disc%', x: 277, width: 35, align: 'right' as const },
  { key: 'taxable', label: 'Taxable', x: 312, width: 55, align: 'right' as const },
  { key: 'tax', label: 'GST%', x: 367, width: 35, align: 'right' as const },
  { key: 'total', label: 'Amount', x: 402, width: 109, align: 'right' as const },
];

export async function renderInvoicePdf(
  tenant: TenantContext,
  invoiceId: string
): Promise<{ buffer: Buffer; fileName: string }> {
  const invoice = await invoiceService.getRaw(tenant, invoiceId);

  const [company, customer] = await Promise.all([
    CompanyModel.findById(tenant.companyId).lean(),
    CustomerModel.findOne(tenantById(tenant, String(invoice.customerId))).lean(),
  ]);

  const doc = new PDFDocument({ size: 'A4', margin: MARGIN });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  /* ----------------------------- Header ----------------------------- */

  doc.fontSize(18).font('Helvetica-Bold').text(company?.name ?? 'Invoice', MARGIN, MARGIN);

  doc.fontSize(9).font('Helvetica').fillColor('#444');
  const companyLines = [
    ...addressLines({ ...company?.address, state: company?.state }),
    company?.gstNumber ? `GSTIN: ${company.gstNumber}` : '',
  ].filter(Boolean);
  companyLines.forEach((line) => doc.text(line, MARGIN, doc.y, { width: 260 }));

  // Title block, right-aligned against the header.
  doc.fillColor('#000').fontSize(20).font('Helvetica-Bold');
  doc.text('TAX INVOICE', MARGIN, MARGIN, { width: CONTENT_WIDTH, align: 'right' });
  doc.fontSize(10).font('Helvetica');
  doc.text(invoice.documentNumber, MARGIN, MARGIN + 26, {
    width: CONTENT_WIDTH,
    align: 'right',
  });
  doc.fillColor('#444').fontSize(9);
  doc.text(`Date: ${formatDate(invoice.date)}`, MARGIN, MARGIN + 42, {
    width: CONTENT_WIDTH,
    align: 'right',
  });
  if (invoice.dueDate) {
    doc.text(`Due: ${formatDate(invoice.dueDate)}`, MARGIN, MARGIN + 55, {
      width: CONTENT_WIDTH,
      align: 'right',
    });
  }

  // A cancelled invoice must never be mistaken for a live one when printed.
  if (invoice.status === 'Cancelled') {
    doc.fillColor('#b91c1c').fontSize(11).font('Helvetica-Bold');
    doc.text('CANCELLED', MARGIN, MARGIN + 70, { width: CONTENT_WIDTH, align: 'right' });
  }

  /* ---------------------------- Bill to ----------------------------- */

  let y = Math.max(doc.y, MARGIN + 92) + 12;
  doc.fillColor('#000').fontSize(9).font('Helvetica-Bold').text('BILL TO', MARGIN, y);
  y += 14;
  doc.fontSize(11).font('Helvetica-Bold').text(invoice.customerName, MARGIN, y);
  y += 15;
  doc.fontSize(9).font('Helvetica').fillColor('#444');
  const customerLines = [
    ...addressLines(customer?.billingAddress as Record<string, string> | undefined),
    customer?.phone ? `Phone: ${customer.phone}` : '',
    customer?.gstNumber ? `GSTIN: ${customer.gstNumber}` : '',
    // Snapshotted GSTIN from the invoice (more reliable — see tradeDocument).
    !customer?.gstNumber && (invoice as any).partyGstin
      ? `GSTIN: ${(invoice as any).partyGstin}`
      : '',
  ].filter(Boolean);
  customerLines.forEach((line) => {
    doc.text(line, MARGIN, y, { width: 280 });
    y += 12;
  });

  /* ---------------------------- Line table -------------------------- */

  y += 10;
  const tableTop = y;

  doc.rect(MARGIN, tableTop, CONTENT_WIDTH, 20).fill('#f1f5f9');
  doc.fillColor('#000').fontSize(9).font('Helvetica-Bold');
  COLUMNS.forEach((column) => {
    doc.text(column.label, MARGIN + column.x + 4, tableTop + 6, {
      width: column.width - 8,
      align: column.align,
    });
  });

  y = tableTop + 20;
  doc.font('Helvetica').fontSize(9);

  invoice.lineItems.forEach((line: any, index: number) => {
    // Page break before a row that would run off the bottom, re-drawing the
    // header so a two-page invoice does not have an unlabelled second table.
    if (y > 690) {
      doc.addPage();
      y = MARGIN;
      doc.rect(MARGIN, y, CONTENT_WIDTH, 20).fill('#f1f5f9');
      doc.fillColor('#000').font('Helvetica-Bold').fontSize(9);
      COLUMNS.forEach((column) => {
        doc.text(column.label, MARGIN + column.x + 4, y + 6, {
          width: column.width - 8,
          align: column.align,
        });
      });
      y += 20;
      doc.font('Helvetica');
    }

    const values: Record<string, string> = {
      index: String(index + 1),
      name: line.name,
      hsn: line.hsnCode ?? '—',
      qty: String(line.quantity),
      rate: money(line.unitPrice),
      disc: line.discountPercent ? `${line.discountPercent}%` : '—',
      taxable: money(line.taxableAmount),
      tax: line.gstPercent ? `${line.gstPercent}%` : '—',
      total: money(line.lineTotal),
    };

    // Measured before drawing so a wrapped item name grows the row rather than
    // overlapping the one below it.
    const nameHeight = doc.heightOfString(line.name, { width: 142 });
    const rowHeight = Math.max(18, nameHeight + 8);

    doc.fillColor('#000');
    COLUMNS.forEach((column) => {
      doc.text(values[column.key], MARGIN + column.x + 4, y + 5, {
        width: column.width - 8,
        align: column.align,
      });
    });

    y += rowHeight;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#e2e8f0').stroke();
  });

  /* ----------------------------- Totals ----------------------------- */

  y += 12;
  const labelX = MARGIN + 300;
  const valueX = MARGIN + 400;
  const valueWidth = CONTENT_WIDTH - 400;

  const totalRow = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9);
    doc.text(label, labelX, y, { width: 96, align: 'right' });
    doc.text(value, valueX, y, { width: valueWidth, align: 'right' });
    y += bold ? 18 : 14;
  };

  totalRow('Subtotal', money(invoice.subTotal));
  if (invoice.totalDiscount > 0) totalRow('Discount', `- ${money(invoice.totalDiscount)}`);

  // GST breakup — show CGST/SGST for intra-state, IGST for inter-state.
  const supplyType: string = (invoice as any).supplyType ?? 'intra';
  const lines = invoice.lineItems as any[];
  const totalCGST = round2(lines.reduce((s, l) => s + (l.cgstAmount ?? 0), 0));
  const totalSGST = round2(lines.reduce((s, l) => s + (l.sgstAmount ?? 0), 0));
  const totalIGST = round2(lines.reduce((s, l) => s + (l.igstAmount ?? 0), 0));
  const totalCESS = round2(lines.reduce((s, l) => s + (l.cessAmount ?? 0), 0));

  if (supplyType === 'inter') {
    if (totalIGST > 0) totalRow(`IGST`, money(totalIGST));
  } else {
    if (totalCGST > 0) totalRow(`CGST`, money(totalCGST));
    if (totalSGST > 0) totalRow(`SGST`, money(totalSGST));
  }
  if (totalCESS > 0) totalRow('CESS', money(totalCESS));
  // Fallback: if GST amounts not yet split (old documents), show combined total.
  if (totalCGST === 0 && totalSGST === 0 && totalIGST === 0 && invoice.totalTax > 0) {
    totalRow('GST', money(invoice.totalTax));
  }

  if (invoice.roundOff !== 0) {
    totalRow('Round off', `${invoice.roundOff > 0 ? '+ ' : '- '}${money(Math.abs(invoice.roundOff))}`);
  }

  doc.moveTo(labelX, y).lineTo(MARGIN + CONTENT_WIDTH, y).strokeColor('#94a3b8').stroke();
  y += 8;
  totalRow('Total', money(invoice.grandTotal), true);

  if (invoice.amountPaid > 0) {
    totalRow('Paid', `- ${money(invoice.amountPaid)}`);
    totalRow('Balance due', money(round2(invoice.grandTotal - invoice.amountPaid)), true);
  }

  /* ----------------------------- Footer ----------------------------- */

  y += 16;
  if (invoice.notes) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Notes', MARGIN, y);
    y += 12;
    doc.font('Helvetica').fillColor('#444').text(invoice.notes, MARGIN, y, { width: 320 });
    y = doc.y + 10;
  }
  if (invoice.termsAndConditions) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text('Terms', MARGIN, y);
    y += 12;
    doc
      .font('Helvetica')
      .fillColor('#444')
      .text(invoice.termsAndConditions, MARGIN, y, { width: 320 });
  }

  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#94a3b8')
    .text(
      'This is a computer-generated invoice.',
      MARGIN,
      780,
      { width: CONTENT_WIDTH, align: 'center' }
    );

  doc.end();

  return {
    buffer: await done,
    // Slashes in a document number would otherwise break the download filename.
    fileName: `${invoice.documentNumber.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`,
  };
}
