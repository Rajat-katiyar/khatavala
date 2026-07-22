import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validate } from '../middlewares/validate.js';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import * as gstService from '../services/gst.service.js';
import {
  hsnSummaryQuerySchema,
  gstr1QuerySchema,
  gstr3bQuerySchema,
  gstLiabilityQuerySchema,
  createGSTRateSchema,
  updateGSTRateSchema,
} from '../validators/gst.validators.js';

/**
 * Phase 14 — GST compliance.
 *
 * Mounted at /gst. All routes require an active company context (requireTenant)
 * and appropriate permissions:
 *   - Report reads  → reports.view
 *   - Rate management → products.view (the GST rate master is a product master
 *     supplemental — no new permission module is introduced.)
 *
 * None of these routes write transaction data. The GSTRate CRUD is the only
 * writer, and it only touches the rate master collection.
 */

const router = Router();
router.use(authenticate, resolveTenant, requireTenant);

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

router.get(
  '/hsn-summary',
  requirePermission('reports', 'view'),
  validate(hsnSummaryQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const rows = await gstService.getHSNSummary(req.tenant!, req.query as any);
    res.json({ success: true, data: rows });
  })
);

router.get(
  '/gstr1',
  requirePermission('reports', 'view'),
  validate(gstr1QuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const summary = await gstService.getGSTR1Summary(req.tenant!, req.query as any);
    res.json({ success: true, data: summary });
  })
);

router.get(
  '/gstr3b',
  requirePermission('reports', 'view'),
  validate(gstr3bQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const summary = await gstService.getGSTR3BSummary(req.tenant!, req.query as any);
    res.json({ success: true, data: summary });
  })
);

router.get(
  '/liability',
  requirePermission('reports', 'view'),
  validate(gstLiabilityQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const liability = await gstService.getGSTLiability(req.tenant!, req.query as any);
    res.json({ success: true, data: liability });
  })
);

/** Returns the e-invoice JSON schema payload. No live IRN registration. */
router.get(
  '/einvoice/:invoiceId',
  requirePermission('sales', 'view'),
  asyncHandler(async (req, res) => {
    const payload = await gstService.exportEInvoiceJSON(req.tenant!, req.params.invoiceId);
    res.json({ success: true, data: payload });
  })
);

/* ------------------------------------------------------------------ *
 * Export endpoints (Excel download)
 * ------------------------------------------------------------------ */

router.get(
  '/gstr1/export',
  requirePermission('reports', 'export'),
  validate(gstr1QuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const ExcelJS = (await import('exceljs')).default;
    const summary = await gstService.getGSTR1Summary(req.tenant!, req.query as any);

    const wb = new ExcelJS.Workbook();

    // Sheet 1 — B2B
    const b2bSheet = wb.addWorksheet('B2B Invoices');
    b2bSheet.columns = [
      { header: 'GSTIN', key: 'gstin', width: 18 },
      { header: 'Legal Name', key: 'partyName', width: 30 },
      { header: 'Invoice No.', key: 'invoiceNumber', width: 18 },
      { header: 'Invoice Date', key: 'invoiceDate', width: 14 },
      { header: 'Invoice Value', key: 'invoiceValue', width: 14 },
      { header: 'Place of Supply', key: 'placeOfSupply', width: 16 },
      { header: 'Taxable Value', key: 'taxableValue', width: 14 },
      { header: 'IGST', key: 'igst', width: 12 },
      { header: 'CGST', key: 'cgst', width: 12 },
      { header: 'SGST', key: 'sgst', width: 12 },
      { header: 'CESS', key: 'cess', width: 10 },
    ];
    b2bSheet.getRow(1).font = { bold: true };
    summary.b2b.forEach((row) => b2bSheet.addRow(row));

    // Sheet 2 — B2C
    const b2cSheet = wb.addWorksheet('B2C Summary');
    b2cSheet.columns = [
      { header: 'Supply Type', key: 'supplyType', width: 14 },
      { header: 'Taxable Value', key: 'taxableValue', width: 14 },
      { header: 'IGST', key: 'igst', width: 12 },
      { header: 'CGST', key: 'cgst', width: 12 },
      { header: 'SGST', key: 'sgst', width: 12 },
      { header: 'CESS', key: 'cess', width: 10 },
    ];
    b2cSheet.getRow(1).font = { bold: true };
    summary.b2c.forEach((row) => b2cSheet.addRow(row));

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="GSTR-1_${summary.period.replace(/\s/g, '_')}.xlsx"`
    );
    res.send(buffer);
  })
);

router.get(
  '/gstr3b/export',
  requirePermission('reports', 'export'),
  validate(gstr3bQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const ExcelJS = (await import('exceljs')).default;
    const summary = await gstService.getGSTR3BSummary(req.tenant!, req.query as any);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('GSTR-3B');
    ws.columns = [
      { header: 'Section', key: 'section', width: 30 },
      { header: 'Taxable Value', key: 'taxableValue', width: 15 },
      { header: 'IGST', key: 'igst', width: 12 },
      { header: 'CGST', key: 'cgst', width: 12 },
      { header: 'SGST/UTGST', key: 'sgst', width: 14 },
      { header: 'CESS', key: 'cess', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };

    ws.addRow({
      section: '3.1 Outward Tax Liability',
      taxableValue: summary.outwardSupplies.taxableValue,
      igst: summary.outwardSupplies.igst,
      cgst: summary.outwardSupplies.cgst,
      sgst: summary.outwardSupplies.sgst,
      cess: summary.outwardSupplies.cess,
    });
    ws.addRow({
      section: '4. ITC Available (Input Tax Credit)',
      taxableValue: '',
      igst: summary.itcAvailable.igst,
      cgst: summary.itcAvailable.cgst,
      sgst: summary.itcAvailable.sgst,
      cess: summary.itcAvailable.cess,
    });
    ws.addRow({
      section: 'Net Tax Payable',
      taxableValue: '',
      igst: summary.netPayable.igst,
      cgst: summary.netPayable.cgst,
      sgst: summary.netPayable.sgst,
      cess: summary.netPayable.cess,
    });
    ws.lastRow!.font = { bold: true };

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="GSTR-3B_${summary.period.replace(/\s/g, '_')}.xlsx"`
    );
    res.send(buffer);
  })
);

/* ------------------------------------------------------------------ *
 * HSN Summary Export
 * ------------------------------------------------------------------ */
router.get(
  '/hsn-summary/export',
  requirePermission('reports', 'export'),
  validate(hsnSummaryQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const ExcelJS = (await import('exceljs')).default;
    const rows = await gstService.getHSNSummary(req.tenant!, req.query as any);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('HSN Summary');
    ws.columns = [
      { header: 'HSN/SAC', key: 'hsnCode', width: 14 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'UQC', key: 'uqc', width: 8 },
      { header: 'Total Quantity', key: 'totalQuantity', width: 14 },
      { header: 'Taxable Value', key: 'taxableValue', width: 14 },
      { header: 'IGST', key: 'integratedTax', width: 12 },
      { header: 'CGST', key: 'centralTax', width: 12 },
      { header: 'SGST/UTGST', key: 'stateTax', width: 14 },
      { header: 'CESS', key: 'cess', width: 10 },
      { header: 'Total Tax', key: 'totalTax', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach((row) => ws.addRow(row));

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="HSN_Summary.xlsx"');
    res.send(buffer);
  })
);

/* ------------------------------------------------------------------ *
 * GST Rate master CRUD
 * ------------------------------------------------------------------ */

router.get(
  '/rates',
  requirePermission('products', 'view'),
  asyncHandler(async (req, res) => {
    const rates = await gstService.listGSTRates(req.tenant!);
    res.json({ success: true, data: rates });
  })
);

router.post(
  '/rates',
  requirePermission('products', 'create'),
  validate(createGSTRateSchema),
  asyncHandler(async (req, res) => {
    const rate = await gstService.upsertGSTRate(req.tenant!, req.body);
    res.status(201).json({ success: true, data: rate });
  })
);

router.put(
  '/rates/:id',
  requirePermission('products', 'edit'),
  validate(updateGSTRateSchema),
  asyncHandler(async (req, res) => {
    const rate = await gstService.updateGSTRate(req.tenant!, req.params.id, req.body);
    res.json({ success: true, data: rate });
  })
);

router.delete(
  '/rates/:id',
  requirePermission('products', 'delete'),
  asyncHandler(async (req, res) => {
    await gstService.deleteGSTRate(req.tenant!, req.params.id);
    res.json({ success: true });
  })
);

export default router;
