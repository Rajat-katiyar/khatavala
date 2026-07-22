import { Types } from 'mongoose';
import ExcelJS from 'exceljs';
import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { PurchaseInvoiceModel } from '../models/PurchaseInvoice.js';
import { ProductModel } from '../models/Product.js';
import { StockLedgerEntryModel } from '../models/StockLedgerEntry.js';
import { CustomerModel } from '../models/Customer.js';
import { SupplierModel } from '../models/Supplier.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';
import { round2 } from './tradeDocument.factory.js';

export interface ReportFilterQuery {
  from?: Date;
  to?: Date;
  customerId?: string;
  supplierId?: string;
  productId?: string;
  search?: string;
}

/**
 * 1. Sales Summary Report Aggregation
 */
export async function getSalesReport(tenant: TenantContext, filters: ReportFilterQuery) {
  const match: Record<string, unknown> = { status: 'Posted' };
  if (filters.from || filters.to) {
    const d: Record<string, Date> = {};
    if (filters.from) d.$gte = filters.from;
    if (filters.to) d.$lte = filters.to;
    match.date = d;
  }
  if (filters.customerId) {
    match.customerId = new Types.ObjectId(filters.customerId);
  }

  const rows = await SalesInvoiceModel.aggregate([
    { $match: tenantFilter(tenant, match) },
    {
      $project: {
        date: 1,
        invoiceNumber: 1,
        customerName: 1,
        taxableValue: '$subTotal',
        totalTax: 1,
        grandTotal: 1,
        balanceDue: 1,
      },
    },
    { $sort: { date: -1 } },
  ]);

  const totalRevenue = rows.reduce((s, r) => s + (r.grandTotal || 0), 0);
  const totalTax = rows.reduce((s, r) => s + (r.totalTax || 0), 0);

  return {
    rows,
    summary: {
      count: rows.length,
      totalRevenue: round2(totalRevenue),
      totalTax: round2(totalTax),
    },
  };
}

/**
 * 2. Purchase Summary Report Aggregation
 */
export async function getPurchaseReport(tenant: TenantContext, filters: ReportFilterQuery) {
  const match: Record<string, unknown> = { status: 'Posted' };
  if (filters.from || filters.to) {
    const d: Record<string, Date> = {};
    if (filters.from) d.$gte = filters.from;
    if (filters.to) d.$lte = filters.to;
    match.date = d;
  }
  if (filters.supplierId) {
    match.supplierId = new Types.ObjectId(filters.supplierId);
  }

  const rows = await PurchaseInvoiceModel.aggregate([
    { $match: tenantFilter(tenant, match) },
    {
      $project: {
        date: 1,
        invoiceNumber: 1,
        supplierName: 1,
        taxableValue: '$subTotal',
        totalTax: 1,
        grandTotal: 1,
        balanceDue: 1,
      },
    },
    { $sort: { date: -1 } },
  ]);

  const totalCost = rows.reduce((s, r) => s + (r.grandTotal || 0), 0);

  return {
    rows,
    summary: {
      count: rows.length,
      totalCost: round2(totalCost),
    },
  };
}

/**
 * 3. Inventory Valuation Report
 */
export async function getInventoryValuationReport(tenant: TenantContext) {
  const products = await ProductModel.find(tenantFilter(tenant, { isActive: true })).lean();

  const items = products.map((p) => {
    const stock = p.currentStock || 0;
    const cost = p.purchasePrice || 0;
    const sellingPrice = p.sellingPrice || 0;
    const totalCostValue = round2(stock * cost);
    const totalRetailValue = round2(stock * sellingPrice);

    return {
      id: String(p._id),
      name: p.name,
      sku: p.sku,
      currentStock: stock,
      purchasePrice: cost,
      sellingPrice,
      totalCostValue,
      totalRetailValue,
    };
  });

  const totalQuantity = items.reduce((s, i) => s + i.currentStock, 0);
  const totalValuationCost = items.reduce((s, i) => s + i.totalCostValue, 0);
  const totalValuationRetail = items.reduce((s, i) => s + i.totalRetailValue, 0);

  return {
    items,
    summary: {
      totalProducts: items.length,
      totalQuantity,
      totalValuationCost: round2(totalValuationCost),
      totalValuationRetail: round2(totalValuationRetail),
    },
  };
}

/**
 * 4. Stock Movement Ledger Report
 */
export async function getStockMovementReport(tenant: TenantContext, filters: ReportFilterQuery) {
  const match: Record<string, unknown> = {};
  if (filters.from || filters.to) {
    const d: Record<string, Date> = {};
    if (filters.from) d.$gte = filters.from;
    if (filters.to) d.$lte = filters.to;
    match.timestamp = d;
  }
  if (filters.productId) {
    match.productId = new Types.ObjectId(filters.productId);
  }

  const movements = await StockLedgerEntryModel.find(tenantFilter(tenant, match))
    .sort({ timestamp: -1 })
    .limit(100)
    .lean();

  const items = await Promise.all(
    movements.map(async (m) => {
      const prod = await ProductModel.findById(m.productId).select('name sku').lean();
      return {
        id: String(m._id),
        date: m.timestamp,
        productName: prod?.name || 'Product',
        sku: prod?.sku || '',
        movementType: m.movementType,
        quantity: m.quantity,
        referenceType: m.referenceType,
        runningBalance: m.runningBalance,
      };
    })
  );

  return { items };
}

/**
 * 5. Customer / Supplier Outstanding Aging Buckets Report
 */
export async function getOutstandingAgingReport(
  tenant: TenantContext,
  type: 'customer' | 'supplier' = 'customer'
) {
  const isCustomer = type === 'customer';
  const unpaidInvoices = isCustomer
    ? await SalesInvoiceModel.find(tenantFilter(tenant, { status: 'Posted', balanceDue: { $gt: 0 } })).lean()
    : await PurchaseInvoiceModel.find(tenantFilter(tenant, { status: 'Posted', balanceDue: { $gt: 0 } })).lean();

  const now = new Date();
  const partyMap: Record<
    string,
    {
      partyName: string;
      totalOutstanding: number;
      bucket0_30: number;
      bucket31_60: number;
      bucket61_90: number;
      bucket90Plus: number;
    }
  > = {};

  for (const inv of unpaidInvoices) {
    const pId = String(isCustomer ? (inv as any).customerId : (inv as any).supplierId);
    if (!partyMap[pId]) {
      let name = 'Party';
      if (isCustomer) {
        const c = await CustomerModel.findById(pId).lean();
        if (c) name = c.name;
      } else {
        const s = await SupplierModel.findById(pId).lean();
        if (s) name = s.name;
      }

      partyMap[pId] = {
        partyName: name,
        totalOutstanding: 0,
        bucket0_30: 0,
        bucket31_60: 0,
        bucket61_90: 0,
        bucket90Plus: 0,
      };
    }

    const due = inv.dueDate ? new Date(inv.dueDate) : new Date(inv.date);
    const diffTime = now.getTime() - due.getTime();
    const daysOverdue = Math.max(0, Math.floor(diffTime / (1000 * 60 * 60 * 24)));
    const balance = inv.balanceDue || 0;

    partyMap[pId].totalOutstanding += balance;

    if (daysOverdue <= 30) {
      partyMap[pId].bucket0_30 += balance;
    } else if (daysOverdue <= 60) {
      partyMap[pId].bucket31_60 += balance;
    } else if (daysOverdue <= 90) {
      partyMap[pId].bucket61_90 += balance;
    } else {
      partyMap[pId].bucket90Plus += balance;
    }
  }

  const rows = Object.values(partyMap).map((row) => ({
    partyName: row.partyName,
    totalOutstanding: round2(row.totalOutstanding),
    bucket0_30: round2(row.bucket0_30),
    bucket31_60: round2(row.bucket31_60),
    bucket61_90: round2(row.bucket61_90),
    bucket90Plus: round2(row.bucket90Plus),
  }));

  const totalOutstanding = rows.reduce((s, r) => s + r.totalOutstanding, 0);
  const total0_30 = rows.reduce((s, r) => s + r.bucket0_30, 0);
  const total31_60 = rows.reduce((s, r) => s + r.bucket31_60, 0);
  const total61_90 = rows.reduce((s, r) => s + r.bucket61_90, 0);
  const total90Plus = rows.reduce((s, r) => s + r.bucket90Plus, 0);

  return {
    rows,
    summary: {
      totalOutstanding: round2(totalOutstanding),
      total0_30: round2(total0_30),
      total31_60: round2(total31_60),
      total61_90: round2(total61_90),
      total90Plus: round2(total90Plus),
    },
  };
}

/**
 * 6. Product Performance Report (Best / Worst Sellers)
 */
export async function getProductPerformanceReport(tenant: TenantContext, filters: ReportFilterQuery) {
  const match: Record<string, unknown> = { status: 'Posted' };
  if (filters.from || filters.to) {
    const d: Record<string, Date> = {};
    if (filters.from) d.$gte = filters.from;
    if (filters.to) d.$lte = filters.to;
    match.date = d;
  }

  const aggregation = await SalesInvoiceModel.aggregate([
    { $match: tenantFilter(tenant, match) },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        name: { $first: '$items.productName' },
        sku: { $first: '$items.sku' },
        totalQuantity: { $sum: '$items.quantity' },
        totalRevenue: { $sum: '$items.lineTotal' },
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  const items = aggregation.map((item) => ({
    id: String(item._id),
    name: item.name || 'Product',
    sku: item.sku || '',
    totalQuantity: item.totalQuantity,
    totalRevenue: round2(item.totalRevenue),
  }));

  return {
    topSellers: items.slice(0, 10),
    slowMovers: [...items].reverse().slice(0, 10),
  };
}

/**
 * Excel Export Generator using ExcelJS
 */
export async function generateReportExcel(reportName: string, headers: string[], rows: any[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(reportName);

  // Header styling
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: '2563EB' },
  };

  rows.forEach((row) => sheet.addRow(row));

  sheet.columns.forEach((col) => {
    col.width = 22;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
