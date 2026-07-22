import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { ProductModel } from '../models/Product.js';
import { tenantFilter, type TenantContext } from '../middlewares/tenantScope.js';
import * as opReportsService from './operationalReports.service.js';
import { round2 } from './tradeDocument.factory.js';

export interface AiQuestionResult {
  question: string;
  answer: string;
  intent: 'sales_summary' | 'top_customers' | 'slow_movers' | 'inventory_valuation' | 'aging' | 'reorder' | 'general';
  chartType: 'bar' | 'line' | 'pie' | 'table';
  chartData: any[];
}

export interface DemandForecastItem {
  productId: string;
  productName: string;
  sku: string;
  currentStock: number;
  minStockLevel: number;
  salesLast30Days: number;
  dailyBurnRate: number;
  daysUntilStockOut: number;
  suggestedReorderQty: number;
  riskLevel: 'High' | 'Medium' | 'Low';
}

/**
 * Natural language Business Question AI Parser & Tool Executor.
 */
export async function answerBusinessQuestion(
  tenant: TenantContext,
  question: string
): Promise<AiQuestionResult> {
  const qLower = question.toLowerCase();

  // Intent 1: Top Customers / Sales by Customer
  if (qLower.includes('customer') || qLower.includes('buyer') || qLower.includes('top sales')) {
    const salesData = await opReportsService.getSalesReport(tenant, {});
    const customerMap: Record<string, number> = {};

    salesData.rows.forEach((r) => {
      customerMap[r.customerName] = (customerMap[r.customerName] || 0) + (r.grandTotal || 0);
    });

    const sorted = Object.entries(customerMap)
      .map(([name, amount]) => ({ name, value: round2(amount) }))
      .sort((a, b) => b.value - a.value);

    const topName = sorted[0]?.name || 'N/A';
    const topVal = sorted[0]?.value || 0;

    return {
      question,
      intent: 'top_customers',
      chartType: 'bar',
      chartData: sorted.slice(0, 5),
      answer: `Based on posted sales invoices, your top revenue customer is **${topName}** generating **₹${topVal.toLocaleString()}**. The top 5 customers account for the majority of sales volume.`,
    };
  }

  // Intent 2: Slow Movers / Product Performance
  if (qLower.includes('not selling') || qLower.includes('slow') || qLower.includes('performance') || qLower.includes('best seller')) {
    const perf = await opReportsService.getProductPerformanceReport(tenant, {});
    const topName = perf.topSellers[0]?.name || 'N/A';

    const chartData = perf.topSellers.map((item) => ({
      name: item.name,
      value: item.totalRevenue,
      quantity: item.totalQuantity,
    }));

    return {
      question,
      intent: 'slow_movers',
      chartType: 'bar',
      chartData: chartData.slice(0, 5),
      answer: `Your best-performing catalog item is **${topName}**. We have identified **${perf.slowMovers.length} slow-moving products** that may require promotional discounts or clearance.`,
    };
  }

  // Intent 3: Inventory Valuation
  if (qLower.includes('inventory') || qLower.includes('stock value') || qLower.includes('worth')) {
    const val = await opReportsService.getInventoryValuationReport(tenant);

    const chartData = val.items.slice(0, 5).map((i) => ({
      name: i.name,
      costValuation: i.totalCostValue,
      retailValuation: i.totalRetailValue,
    }));

    return {
      question,
      intent: 'inventory_valuation',
      chartType: 'bar',
      chartData,
      answer: `Your total inventory is currently valued at **₹${val.summary.totalValuationCost.toLocaleString()}** (Cost Basis) and **₹${val.summary.totalValuationRetail.toLocaleString()}** (Retail Market Basis) across **${val.summary.totalQuantity} total units** in stock.`,
    };
  }

  // Intent 4: Outstanding Aging / Unpaid Invoices
  if (qLower.includes('aging') || qLower.includes('overdue') || qLower.includes('unpaid') || qLower.includes('due')) {
    const aging = await opReportsService.getOutstandingAgingReport(tenant, 'customer');

    const chartData = [
      { name: '0-30 Days', value: aging.summary.total0_30 },
      { name: '31-60 Days', value: aging.summary.total31_60 },
      { name: '61-90 Days', value: aging.summary.total61_90 },
      { name: '90+ Days', value: aging.summary.total90Plus },
    ];

    return {
      question,
      intent: 'aging',
      chartType: 'bar',
      chartData,
      answer: `Total customer receivables outstanding stands at **₹${aging.summary.totalOutstanding.toLocaleString()}**. **₹${aging.summary.total90Plus.toLocaleString()}** is over 90 days past due and requires urgent payment reminder follow-up.`,
    };
  }

  // Fallback: Sales Summary / General AI Response
  const sales = await opReportsService.getSalesReport(tenant, {});
  const chartData = sales.rows.slice(0, 7).map((r) => ({
    name: r.invoiceNumber,
    value: r.grandTotal,
  }));

  return {
    question,
    intent: 'sales_summary',
    chartType: 'line',
    chartData,
    answer: `Over the current period, Khatavala recorded **${sales.summary.count} invoices** totaling **₹${sales.summary.totalRevenue.toLocaleString()}** in revenue with **₹${sales.summary.totalTax.toLocaleString()}** in total GST tax.`,
  };
}

/**
 * Smart Reorder Suggestion & Demand Forecast Engine.
 */
export async function getDemandForecast(tenant: TenantContext): Promise<DemandForecastItem[]> {
  const products = await ProductModel.find(tenantFilter(tenant, { isActive: true })).lean();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Aggregate quantity sold per product over last 30 days
  const salesAgg = await SalesInvoiceModel.aggregate([
    { $match: tenantFilter(tenant, { status: 'Posted', date: { $gte: thirtyDaysAgo } }) },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        totalSold: { $sum: '$items.quantity' },
      },
    },
  ]);

  const salesMap = new Map<string, number>();
  salesAgg.forEach((a) => salesMap.set(String(a._id), a.totalSold));

  const results: DemandForecastItem[] = [];

  for (const p of products) {
    const pId = String(p._id);
    const stock = p.currentStock || 0;
    const minLevel = p.minStockLevel || 5;
    const sold30 = salesMap.get(pId) || 0;
    const dailyBurn = round2(sold30 / 30);

    const daysLeft = dailyBurn > 0 ? Math.floor(stock / dailyBurn) : 999;
    const targetBuffer = Math.max(minLevel * 2, Math.ceil(dailyBurn * 30));
    const suggestedReorder = stock < targetBuffer ? targetBuffer - stock : 0;

    let riskLevel: 'High' | 'Medium' | 'Low' = 'Low';
    if (stock <= minLevel || daysLeft <= 7) {
      riskLevel = 'High';
    } else if (daysLeft <= 20 || stock <= minLevel * 1.5) {
      riskLevel = 'Medium';
    }

    results.push({
      productId: pId,
      productName: p.name,
      sku: p.sku,
      currentStock: stock,
      minStockLevel: minLevel,
      salesLast30Days: sold30,
      dailyBurnRate: dailyBurn,
      daysUntilStockOut: daysLeft > 99 ? 99 : daysLeft,
      suggestedReorderQty: suggestedReorder,
      riskLevel,
    });
  }

  return results.sort((a, b) => (a.riskLevel === 'High' ? -1 : 1));
}
