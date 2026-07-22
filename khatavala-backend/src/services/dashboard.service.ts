import { Types } from 'mongoose';
import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { PurchaseInvoiceModel } from '../models/PurchaseInvoice.js';
import { PaymentModel } from '../models/Payment.js';
import { ProductModel } from '../models/Product.js';
import { ExpenseModel } from '../models/Expense.js';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';
import { round2 } from './tradeDocument.factory.js';

export interface DashboardRangeQuery {
  range?: 'today' | 'week' | 'month' | 'year' | 'custom';
  from?: Date;
  to?: Date;
}

export interface DashboardMetrics {
  kpis: {
    totalSales: number;
    totalPurchases: number;
    cashCollected: number;
    outstandingReceivables: number;
    outstandingPayables: number;
    totalExpenses: number;
    netProfit: number;
  };
  salesTrend: Array<{ date: string; sales: number; purchases: number }>;
  topProducts: Array<{ id: string; name: string; sku: string; quantity: number; revenue: number }>;
  topCustomers: Array<{ id: string; name: string; revenue: number }>;
  paymentModeSplit: Array<{ mode: string; amount: number; count: number }>;
  lowStockAlerts: {
    count: number;
    items: Array<{ id: string; name: string; sku: string; stockQuantity: number; minStockLevel: number }>;
  };
  gstLiability: {
    outwardTax: number;
    itcAvailable: number;
    netPayable: number;
  };
}

/**
 * Calculates date range boundaries based on preset or custom dates.
 */
function resolveDateRange(query: DashboardRangeQuery): { start: Date; end: Date } {
  const now = new Date();
  let start = new Date(now.getFullYear(), now.getMonth(), 1); // default this month
  let end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

  if (query.range === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (query.range === 'week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    start = new Date(now.setDate(diff));
    start.setHours(0, 0, 0, 0);
    end = new Date();
    end.setHours(23, 59, 59, 999);
  } else if (query.range === 'year') {
    start = new Date(now.getFullYear(), 0, 1, 0, 0, 0);
    end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else if (query.range === 'custom' && query.from && query.to) {
    start = new Date(query.from);
    end = new Date(query.to);
  }

  return { start, end };
}

/**
 * Generates cache key for Redis dashboard storage.
 */
function buildCacheKey(companyId: string | Types.ObjectId, range: string, start: Date, end: Date): string {
  return `dashboard:${companyId}:${range}:${start.toISOString().split('T')[0]}:${end.toISOString().split('T')[0]}`;
}

/**
 * Invalidates cached dashboard keys for a tenant.
 */
export async function invalidateDashboardCache(companyId: string | Types.ObjectId): Promise<void> {
  try {
    if (redis.status === 'ready') {
      const keys = await redis.keys(`dashboard:${companyId}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info(`Invalidated ${keys.length} dashboard cache keys for company ${companyId}`);
      }
    }
  } catch (err) {
    logger.warn('Failed to invalidate dashboard cache in Redis', err);
  }
}

/**
 * Fetches aggregated dashboard metrics using MongoDB Pipelines.
 * Serves from Redis cache if available (60s TTL).
 */
export async function getDashboardMetrics(
  tenant: TenantContext,
  query: DashboardRangeQuery = {}
): Promise<DashboardMetrics> {
  const { start, end } = resolveDateRange(query);
  const rangeName = query.range || 'month';
  const cacheKey = buildCacheKey(tenant.companyId, rangeName, start, end);

  // Try reading from Redis cache
  try {
    if (redis.status === 'ready') {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as DashboardMetrics;
      }
    }
  } catch (_err) {
    // Silent fallback if Redis is down
  }

  // Execute MongoDB Aggregation Pipelines in Parallel
  const [
    salesAggregate,
    purchaseAggregate,
    cashAggregate,
    receivablesAggregate,
    payablesAggregate,
    expensesAggregate,
    topProductsAggregate,
    topCustomersAggregate,
    salesTrendAggregate,
    paymentSplitAggregate,
    lowStockItems,
    gstSalesAggregate,
    gstPurchaseAggregate,
  ] = await Promise.all([
    // 1. Sales Total in Range
    SalesInvoiceModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', date: { $gte: start, $lte: end } }) },
      { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
    ]),

    // 2. Purchases Total in Range
    PurchaseInvoiceModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', date: { $gte: start, $lte: end } }) },
      { $group: { _id: null, total: { $sum: '$grandTotal' }, count: { $sum: 1 } } },
    ]),

    // 3. Cash & Bank Collections in Range
    PaymentModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', paymentDate: { $gte: start, $lte: end } }) },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),

    // 4. Total Outstanding Receivables (All time unpaid Sales Invoices)
    SalesInvoiceModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', balanceDue: { $gt: 0 } }) },
      { $group: { _id: null, total: { $sum: '$balanceDue' } } },
    ]),

    // 5. Total Outstanding Payables (All time unpaid Purchase Invoices)
    PurchaseInvoiceModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', balanceDue: { $gt: 0 } }) },
      { $group: { _id: null, total: { $sum: '$balanceDue' } } },
    ]),

    // 6. Expenses in Range
    ExpenseModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', date: { $gte: start, $lte: end } }) },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),

    // 7. Top 5 Selling Products (Line items aggregation)
    SalesInvoiceModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', date: { $gte: start, $lte: end } }) },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.productId',
          name: { $first: '$items.productName' },
          sku: { $first: '$items.sku' },
          quantity: { $sum: '$items.quantity' },
          revenue: { $sum: '$items.lineTotal' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]),

    // 8. Top 5 Customers by Revenue
    SalesInvoiceModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', date: { $gte: start, $lte: end } }) },
      {
        $group: {
          _id: '$customerId',
          revenue: { $sum: '$grandTotal' },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'customers',
          localField: '_id',
          foreignField: '_id',
          as: 'customer',
        },
      },
      { $unwind: '$customer' },
      {
        $project: {
          id: '$_id',
          name: '$customer.name',
          revenue: 1,
        },
      },
    ]),

    // 9. Sales & Purchases Trend Time-Series
    SalesInvoiceModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', date: { $gte: start, $lte: end } }) },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$date' } },
          sales: { $sum: '$grandTotal' },
        },
      },
      { $sort: { _id: 1 } },
    ]),

    // 10. Payment Mode Split
    PaymentModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', paymentDate: { $gte: start, $lte: end } }) },
      {
        $group: {
          _id: '$paymentMode',
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]),

    // 11. Low Stock Products
    ProductModel.find(
      tenantFilter(tenant, {
        isActive: true,
        minStockLevel: { $type: 'number' },
        $expr: { $lte: ['$currentStock', '$minStockLevel'] },
      })
    )
      .select('name sku currentStock minStockLevel')
      .limit(10)
      .lean(),

    // 12. GST Outward Tax in Range
    SalesInvoiceModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', date: { $gte: start, $lte: end } }) },
      {
        $group: {
          _id: null,
          cgst: { $sum: '$cgstTotal' },
          sgst: { $sum: '$sgstTotal' },
          igst: { $sum: '$igstTotal' },
        },
      },
    ]),

    // 13. GST ITC Available in Range
    PurchaseInvoiceModel.aggregate([
      { $match: tenantFilter(tenant, { status: 'Posted', date: { $gte: start, $lte: end } }) },
      {
        $group: {
          _id: null,
          cgst: { $sum: '$cgstTotal' },
          sgst: { $sum: '$sgstTotal' },
          igst: { $sum: '$igstTotal' },
        },
      },
    ]),
  ]);

  // Process KPI values
  const totalSales = round2(salesAggregate[0]?.total ?? 0);
  const totalPurchases = round2(purchaseAggregate[0]?.total ?? 0);
  const cashCollected = round2(cashAggregate[0]?.total ?? 0);
  const outstandingReceivables = round2(receivablesAggregate[0]?.total ?? 0);
  const outstandingPayables = round2(payablesAggregate[0]?.total ?? 0);
  const totalExpenses = round2(expensesAggregate[0]?.total ?? 0);
  const netProfit = round2(totalSales - totalPurchases - totalExpenses);

  // Process GST
  const outwardTax = round2(
    (gstSalesAggregate[0]?.cgst ?? 0) +
      (gstSalesAggregate[0]?.sgst ?? 0) +
      (gstSalesAggregate[0]?.igst ?? 0)
  );
  const itcAvailable = round2(
    (gstPurchaseAggregate[0]?.cgst ?? 0) +
      (gstPurchaseAggregate[0]?.sgst ?? 0) +
      (gstPurchaseAggregate[0]?.igst ?? 0)
  );
  const netPayable = round2(Math.max(0, outwardTax - itcAvailable));

  // Format Top Products
  const topProducts = topProductsAggregate.map((p) => ({
    id: String(p._id),
    name: p.name || 'Product',
    sku: p.sku || '',
    quantity: p.quantity,
    revenue: round2(p.revenue),
  }));

  // Format Top Customers
  const topCustomers = topCustomersAggregate.map((c) => ({
    id: String(c.id),
    name: c.name || 'Customer',
    revenue: round2(c.revenue),
  }));

  // Format Trend
  const salesTrend = salesTrendAggregate.map((t) => ({
    date: t._id,
    sales: round2(t.sales),
    purchases: 0,
  }));

  // Format Payment Mode Split
  const paymentModeSplit = paymentSplitAggregate.map((p) => ({
    mode: p._id || 'Cash',
    amount: round2(p.amount),
    count: p.count,
  }));

  const metrics: DashboardMetrics = {
    kpis: {
      totalSales,
      totalPurchases,
      cashCollected,
      outstandingReceivables,
      outstandingPayables,
      totalExpenses,
      netProfit,
    },
    salesTrend,
    topProducts,
    topCustomers,
    paymentModeSplit,
    lowStockAlerts: {
      count: lowStockItems.length,
      items: lowStockItems.map((item) => ({
        id: String(item._id),
        name: item.name,
        sku: item.sku,
        stockQuantity: item.currentStock,
        minStockLevel: item.minStockLevel ?? 0,
      })),
    },
    gstLiability: {
      outwardTax,
      itcAvailable,
      netPayable,
    },
  };

  // Cache in Redis (60s TTL) if online
  try {
    if (redis.status === 'ready') {
      await redis.setex(cacheKey, 60, JSON.stringify(metrics));
    }
  } catch (_err) {
    // Ignore cache write errors
  }

  return metrics;
}
