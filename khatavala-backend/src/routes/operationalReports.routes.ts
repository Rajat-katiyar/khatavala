import { Router } from 'express';
import { authenticate } from '../middlewares/auth.js';
import { requireTenant, resolveTenant } from '../middlewares/tenantScope.js';
import { requirePermission } from '../services/permission.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as opReportsService from '../services/operationalReports.service.js';

const router = Router();

router.use(authenticate, resolveTenant, requireTenant);

function parseFilterQuery(reqQuery: any): opReportsService.ReportFilterQuery {
  return {
    from: reqQuery.from ? new Date(reqQuery.from) : undefined,
    to: reqQuery.to ? new Date(reqQuery.to) : undefined,
    customerId: reqQuery.customerId,
    supplierId: reqQuery.supplierId,
    productId: reqQuery.productId,
    search: reqQuery.search,
  };
}

router.get(
  '/sales',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const filters = parseFilterQuery(req.query);
    const data = await opReportsService.getSalesReport(req.tenant!, filters);
    res.json({ success: true, data });
  })
);

router.get(
  '/purchases',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const filters = parseFilterQuery(req.query);
    const data = await opReportsService.getPurchaseReport(req.tenant!, filters);
    res.json({ success: true, data });
  })
);

router.get(
  '/inventory-valuation',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const data = await opReportsService.getInventoryValuationReport(req.tenant!);
    res.json({ success: true, data });
  })
);

router.get(
  '/stock-movement',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const filters = parseFilterQuery(req.query);
    const data = await opReportsService.getStockMovementReport(req.tenant!, filters);
    res.json({ success: true, data });
  })
);

router.get(
  '/aging',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const type = (req.query.type as 'customer' | 'supplier') || 'customer';
    const data = await opReportsService.getOutstandingAgingReport(req.tenant!, type);
    res.json({ success: true, data });
  })
);

router.get(
  '/product-performance',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const filters = parseFilterQuery(req.query);
    const data = await opReportsService.getProductPerformanceReport(req.tenant!, filters);
    res.json({ success: true, data });
  })
);

router.get(
  '/export-excel',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const reportType = req.query.type as string;

    let headers: string[] = [];
    let rows: any[][] = [];
    let title = 'Report';

    if (reportType === 'sales') {
      title = 'Sales_Report';
      headers = ['Date', 'Invoice #', 'Customer', 'Taxable Value', 'Total Tax', 'Grand Total'];
      const data = await opReportsService.getSalesReport(req.tenant!, parseFilterQuery(req.query));
      rows = data.rows.map((r) => [
        new Date(r.date).toLocaleDateString(),
        r.invoiceNumber,
        r.customerName,
        r.taxableValue,
        r.totalTax,
        r.grandTotal,
      ]);
    } else if (reportType === 'purchases') {
      title = 'Purchase_Report';
      headers = ['Date', 'Bill #', 'Supplier', 'Taxable Value', 'Total Tax', 'Grand Total'];
      const data = await opReportsService.getPurchaseReport(req.tenant!, parseFilterQuery(req.query));
      rows = data.rows.map((r) => [
        new Date(r.date).toLocaleDateString(),
        r.invoiceNumber,
        r.supplierName,
        r.taxableValue,
        r.totalTax,
        r.grandTotal,
      ]);
    } else if (reportType === 'valuation') {
      title = 'Inventory_Valuation';
      headers = ['SKU', 'Product Name', 'Current Stock', 'Purchase Rate', 'Selling Price', 'Cost Valuation', 'Retail Valuation'];
      const data = await opReportsService.getInventoryValuationReport(req.tenant!);
      rows = data.items.map((i) => [
        i.sku,
        i.name,
        i.currentStock,
        i.purchasePrice,
        i.sellingPrice,
        i.totalCostValue,
        i.totalRetailValue,
      ]);
    } else if (reportType === 'aging') {
      const partyKind = (req.query.partyKind as 'customer' | 'supplier') || 'customer';
      title = `${partyKind}_Outstanding_Aging`;
      headers = ['Party Name', 'Total Outstanding', '0-30 Days', '31-60 Days', '61-90 Days', '90+ Days'];
      const data = await opReportsService.getOutstandingAgingReport(req.tenant!, partyKind);
      rows = data.rows.map((r) => [
        r.partyName,
        r.totalOutstanding,
        r.bucket0_30,
        r.bucket31_60,
        r.bucket61_90,
        r.bucket90Plus,
      ]);
    }

    const excelBuffer = await opReportsService.generateReportExcel(title, headers, rows);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${title}.xlsx`);
    res.send(excelBuffer);
  })
);

export default router;
