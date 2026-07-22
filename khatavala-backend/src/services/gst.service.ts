import { Types, type PipelineStage } from 'mongoose';
import { ApiError } from '../utils/ApiError.js';
import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { PurchaseInvoiceModel } from '../models/PurchaseInvoice.js';
import { GSTRateModel } from '../models/GSTRate.js';
import { CompanyModel } from '../models/Company.js';
import { CustomerModel } from '../models/Customer.js';
import { tenantFilter, tenantById, type TenantContext } from '../middlewares/tenantScope.js';
import { round2 } from './tradeDocument.factory.js';

/**
 * GST COMPLIANCE SERVICE — Phase 14
 * ===================================
 * All GST-specific aggregations and exports. None of these write; they read
 * from the already-posted invoices (which carry supplyType and the split
 * cgst/sgst/igst amounts) and the purchase invoices (for ITC).
 *
 * GSTR-1 STRUCTURE (outward supplies):
 *   B2B — invoices where the buyer has a GSTIN (partyGstin is set).
 *   B2C — invoices where the buyer is a consumer (no GSTIN).
 *
 * GSTR-3B STRUCTURE:
 *   3.1 — Outward tax liability (sales CGST + SGST + IGST).
 *   4   — ITC available (purchase CGST + SGST + IGST, assuming all eligible).
 *   Net payable = outward − ITC.
 */

/* ------------------------------------------------------------------ *
 * Shared date filter helper
 * ------------------------------------------------------------------ */

function dateRange(from?: Date, to?: Date): Record<string, Date> {
  const f: Record<string, Date> = {};
  if (from) f.$gte = from;
  if (to) f.$lte = to;
  return f;
}

function periodMatch(period: PeriodQuery): Record<string, unknown> {
  if (period.month && period.year) {
    const start = new Date(period.year, period.month - 1, 1);
    const end = new Date(period.year, period.month, 0, 23, 59, 59, 999);
    return { $gte: start, $lte: end };
  }
  return dateRange(period.from, period.to);
}

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export interface PeriodQuery {
  month?: number;
  year?: number;
  from?: Date;
  to?: Date;
}

export interface HSNSummaryRow {
  hsnCode: string;
  description: string;
  uqc: string; // Unit Quantity Code — 'NOS' by default
  totalQuantity: number;
  taxableValue: number;
  integratedTax: number; // IGST
  centralTax: number;   // CGST
  stateTax: number;     // SGST/UTGST
  cess: number;
  totalTax: number;
}

export interface GSTR1B2BInvoice {
  gstin: string;
  partyName: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  placeOfSupply: string;
  reverseCharge: boolean;
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface GSTR1B2CSummary {
  supplyType: 'intra' | 'inter';
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface GSTR1Summary {
  period: string;
  b2b: GSTR1B2BInvoice[];
  b2c: GSTR1B2CSummary[];
  totals: {
    taxableValue: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    invoiceCount: number;
  };
}

export interface GSTR3BSummary {
  period: string;
  outwardSupplies: {
    taxableValue: number;
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  };
  itcAvailable: {
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
  };
  netPayable: {
    igst: number;
    cgst: number;
    sgst: number;
    cess: number;
    total: number;
  };
}

export interface GSTLiability {
  period: string;
  outwardTax: number;
  itcAvailable: number;
  netPayable: number;
}

/* ------------------------------------------------------------------ *
 * HSN Summary — grouped by HSN code
 * ------------------------------------------------------------------ */

export async function getHSNSummary(
  tenant: TenantContext,
  period: PeriodQuery
): Promise<HSNSummaryRow[]> {
  const dateCond = periodMatch(period);

  const pipeline: PipelineStage[] = [
    {
      $match: tenantFilter(tenant, {
        status: { $in: ['Unpaid', 'PartiallyPaid', 'Paid'] },
        date: dateCond,
      }),
    },
    { $unwind: '$lineItems' },
    {
      $group: {
        _id: { hsnCode: { $ifNull: ['$lineItems.hsnCode', 'UNCLASSIFIED'] } },
        totalQuantity: { $sum: '$lineItems.quantity' },
        taxableValue: { $sum: '$lineItems.taxableAmount' },
        integratedTax: { $sum: '$lineItems.igstAmount' },
        centralTax: { $sum: '$lineItems.cgstAmount' },
        stateTax: { $sum: '$lineItems.sgstAmount' },
        cess: { $sum: '$lineItems.cessAmount' },
      },
    },
    { $sort: { '_id.hsnCode': 1 } },
  ];

  const rows = await SalesInvoiceModel.aggregate(pipeline);

  // Fetch descriptions from GSTRate master where available.
  const hsnCodes = rows.map((r) => r._id.hsnCode as string);
  const rates = await GSTRateModel.find(
    tenantFilter(tenant, { hsnCode: { $in: hsnCodes } })
  )
    .select('hsnCode description')
    .lean();
  const descByHsn = new Map(rates.map((r) => [r.hsnCode.toUpperCase(), r.description]));

  return rows.map((row) => {
    const totalTax =
      round2(row.integratedTax + row.centralTax + row.stateTax + row.cess);
    return {
      hsnCode: row._id.hsnCode,
      description: descByHsn.get(String(row._id.hsnCode).toUpperCase()) ?? '',
      uqc: 'NOS',
      totalQuantity: round2(row.totalQuantity),
      taxableValue: round2(row.taxableValue),
      integratedTax: round2(row.integratedTax),
      centralTax: round2(row.centralTax),
      stateTax: round2(row.stateTax),
      cess: round2(row.cess),
      totalTax,
    };
  });
}

/* ------------------------------------------------------------------ *
 * GSTR-1 — outward supply summary
 * ------------------------------------------------------------------ */

export async function getGSTR1Summary(
  tenant: TenantContext,
  period: PeriodQuery
): Promise<GSTR1Summary> {
  const dateCond = periodMatch(period);

  const invoices = await SalesInvoiceModel.find(
    tenantFilter(tenant, {
      status: { $in: ['Unpaid', 'PartiallyPaid', 'Paid'] },
      date: dateCond,
    })
  )
    .select(
      'documentNumber date grandTotal partyGstin customerName supplyType lineItems'
    )
    .lean();

  // Fetch customer info for display name + state (for place of supply).
  const customerIds = [...new Set(invoices.map((inv) => String((inv as any).customerId)))];
  const customers = await CustomerModel.find(
    tenantFilter(tenant, { _id: { $in: customerIds.map((id) => new Types.ObjectId(id)) } })
  )
    .select('_id name gstNumber billingAddress')
    .lean();
  const customerMap = new Map(customers.map((c) => [String(c._id), c]));

  const b2b: GSTR1B2BInvoice[] = [];
  const b2cAcc: Record<string, GSTR1B2CSummary> = {};

  for (const inv of invoices) {
    const lines = (inv.lineItems as any[]) ?? [];
    const taxableValue = round2(lines.reduce((s, l) => s + (l.taxableAmount ?? 0), 0));
    const igst = round2(lines.reduce((s, l) => s + (l.igstAmount ?? 0), 0));
    const cgst = round2(lines.reduce((s, l) => s + (l.cgstAmount ?? 0), 0));
    const sgst = round2(lines.reduce((s, l) => s + (l.sgstAmount ?? 0), 0));
    const cess = round2(lines.reduce((s, l) => s + (l.cessAmount ?? 0), 0));

    const cust = customerMap.get(String((inv as any).customerId));
    const gstin = (inv as any).partyGstin ?? cust?.gstNumber ?? null;
    const supplyType: 'intra' | 'inter' = ((inv as any).supplyType ?? 'intra') as 'intra' | 'inter';

    if (gstin) {
      // B2B — buyer is registered.
      const stateCode = gstin.substring(0, 2);
      b2b.push({
        gstin,
        partyName: (inv as any).customerName ?? cust?.name ?? '',
        invoiceNumber: inv.documentNumber,
        invoiceDate: (inv.date as Date).toISOString().split('T')[0],
        invoiceValue: inv.grandTotal,
        placeOfSupply: stateCode,
        reverseCharge: false,
        taxableValue,
        igst,
        cgst,
        sgst,
        cess,
      });
    } else {
      // B2C — consumer supply, aggregate by supply type.
      const key = supplyType;
      if (!b2cAcc[key]) {
        b2cAcc[key] = { supplyType, taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
      }
      b2cAcc[key].taxableValue = round2(b2cAcc[key].taxableValue + taxableValue);
      b2cAcc[key].igst = round2(b2cAcc[key].igst + igst);
      b2cAcc[key].cgst = round2(b2cAcc[key].cgst + cgst);
      b2cAcc[key].sgst = round2(b2cAcc[key].sgst + sgst);
      b2cAcc[key].cess = round2(b2cAcc[key].cess + cess);
    }
  }

  const b2c = Object.values(b2cAcc);

  const allTaxable = [...b2b.map((r) => r.taxableValue), ...b2c.map((r) => r.taxableValue)];
  const totals = {
    taxableValue: round2(allTaxable.reduce((s, v) => s + v, 0)),
    igst: round2([...b2b, ...b2c].reduce((s, r) => s + r.igst, 0)),
    cgst: round2([...b2b, ...b2c].reduce((s, r) => s + r.cgst, 0)),
    sgst: round2([...b2b, ...b2c].reduce((s, r) => s + r.sgst, 0)),
    cess: round2([...b2b, ...b2c].reduce((s, r) => s + r.cess, 0)),
    invoiceCount: invoices.length,
  };

  return { period: formatPeriodLabel(period), b2b, b2c, totals };
}

/* ------------------------------------------------------------------ *
 * GSTR-3B — net tax payable
 * ------------------------------------------------------------------ */

export async function getGSTR3BSummary(
  tenant: TenantContext,
  period: PeriodQuery
): Promise<GSTR3BSummary> {
  const dateCond = periodMatch(period);

  const [outPipeline, inPipeline] = await Promise.all([
    SalesInvoiceModel.aggregate([
      {
        $match: tenantFilter(tenant, {
          status: { $in: ['Unpaid', 'PartiallyPaid', 'Paid'] },
          date: dateCond,
        }),
      },
      { $unwind: '$lineItems' },
      {
        $group: {
          _id: null,
          taxableValue: { $sum: '$lineItems.taxableAmount' },
          igst: { $sum: '$lineItems.igstAmount' },
          cgst: { $sum: '$lineItems.cgstAmount' },
          sgst: { $sum: '$lineItems.sgstAmount' },
          cess: { $sum: '$lineItems.cessAmount' },
        },
      },
    ]),
    PurchaseInvoiceModel.aggregate([
      {
        $match: tenantFilter(tenant, {
          status: { $in: ['Unpaid', 'PartiallyPaid', 'Paid'] },
          date: dateCond,
        }),
      },
      { $unwind: '$lineItems' },
      {
        $group: {
          _id: null,
          igst: { $sum: '$lineItems.igstAmount' },
          cgst: { $sum: '$lineItems.cgstAmount' },
          sgst: { $sum: '$lineItems.sgstAmount' },
          cess: { $sum: '$lineItems.cessAmount' },
        },
      },
    ]),
  ]);

  const out = outPipeline[0] ?? { taxableValue: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
  const itc = inPipeline[0] ?? { igst: 0, cgst: 0, sgst: 0, cess: 0 };

  const outwardSupplies = {
    taxableValue: round2(out.taxableValue),
    igst: round2(out.igst),
    cgst: round2(out.cgst),
    sgst: round2(out.sgst),
    cess: round2(out.cess),
  };

  const itcAvailable = {
    igst: round2(itc.igst),
    cgst: round2(itc.cgst),
    sgst: round2(itc.sgst),
    cess: round2(itc.cess),
  };

  const netPayable = {
    igst: round2(Math.max(0, outwardSupplies.igst - itcAvailable.igst)),
    cgst: round2(Math.max(0, outwardSupplies.cgst - itcAvailable.cgst)),
    sgst: round2(Math.max(0, outwardSupplies.sgst - itcAvailable.sgst)),
    cess: round2(Math.max(0, outwardSupplies.cess - itcAvailable.cess)),
    total: 0,
  };
  netPayable.total = round2(netPayable.igst + netPayable.cgst + netPayable.sgst + netPayable.cess);

  return {
    period: formatPeriodLabel(period),
    outwardSupplies,
    itcAvailable,
    netPayable,
  };
}

/* ------------------------------------------------------------------ *
 * GST Liability — thin wrapper for the dashboard widget
 * ------------------------------------------------------------------ */

export async function getGSTLiability(
  tenant: TenantContext,
  period: PeriodQuery
): Promise<GSTLiability> {
  const summary = await getGSTR3BSummary(tenant, period);
  const outwardTax = round2(
    summary.outwardSupplies.igst +
    summary.outwardSupplies.cgst +
    summary.outwardSupplies.sgst +
    summary.outwardSupplies.cess
  );
  const itcAvailable = round2(
    summary.itcAvailable.igst +
    summary.itcAvailable.cgst +
    summary.itcAvailable.sgst +
    summary.itcAvailable.cess
  );
  return {
    period: summary.period,
    outwardTax,
    itcAvailable,
    netPayable: summary.netPayable.total,
  };
}

/* ------------------------------------------------------------------ *
 * e-Invoice JSON — IRN-schema payload (no live API)
 * ------------------------------------------------------------------ */

export async function exportEInvoiceJSON(tenant: TenantContext, invoiceId: string) {
  if (!Types.ObjectId.isValid(invoiceId)) throw ApiError.badRequest('Invalid invoice id');

  const invoice = await SalesInvoiceModel.findOne(tenantById(tenant, invoiceId)).lean();
  if (!invoice) throw ApiError.notFound('Invoice not found');

  const company = await CompanyModel.findById(tenant.companyId).lean();
  if (!company) throw ApiError.notFound('Company not found');

  const supplyType: string = (invoice as any).supplyType ?? 'intra';
  const lines = (invoice.lineItems ?? []) as any[];

  return {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: supplyType === 'inter' ? 'EXPWOP' : 'B2B',
      RegRev: 'N',
      EcmGstin: null,
    },
    DocDtls: {
      Typ: 'INV',
      No: invoice.documentNumber,
      Dt: (invoice.date as Date).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
    },
    SellerDtls: {
      Gstin: company.gstNumber ?? '',
      LglNm: company.name,
      TrdNm: company.name,
      Addr1: company.address?.line1 ?? '',
      Addr2: company.address?.line2 ?? '',
      Loc: company.address?.city ?? '',
      Pin: company.address?.pincode ?? '',
      Stcd: company.gstNumber?.substring(0, 2) ?? '',
    },
    BuyerDtls: {
      Gstin: (invoice as any).partyGstin ?? 'URP',
      LglNm: (invoice as any).customerName ?? '',
      TrdNm: (invoice as any).customerName ?? '',
      Pos: (invoice as any).partyGstin?.substring(0, 2) ??
           company.gstNumber?.substring(0, 2) ?? '',
      Addr1: '',
      Loc: '',
      Pin: '',
      Stcd: '',
    },
    ItemList: lines.map((line, index) => ({
      SlNo: String(index + 1),
      PrdDesc: line.name,
      IsServc: 'N',
      HsnCd: line.hsnCode ?? '',
      Qty: line.quantity,
      Unit: 'NOS',
      UnitPrice: line.unitPrice,
      TotAmt: round2(line.quantity * line.unitPrice),
      Discount: line.discountAmount ?? 0,
      AssAmt: line.taxableAmount,
      GstRt: line.gstPercent ?? 0,
      IgstAmt: line.igstAmount ?? 0,
      CgstAmt: line.cgstAmount ?? 0,
      SgstAmt: line.sgstAmount ?? 0,
      CesRt: line.cessPercent ?? 0,
      CesAmt: line.cessAmount ?? 0,
      TotItemVal: line.lineTotal,
    })),
    ValDtls: {
      AssVal: round2(lines.reduce((s, l) => s + (l.taxableAmount ?? 0), 0)),
      IgstVal: round2(lines.reduce((s, l) => s + (l.igstAmount ?? 0), 0)),
      CgstVal: round2(lines.reduce((s, l) => s + (l.cgstAmount ?? 0), 0)),
      SgstVal: round2(lines.reduce((s, l) => s + (l.sgstAmount ?? 0), 0)),
      CesVal: round2(lines.reduce((s, l) => s + (l.cessAmount ?? 0), 0)),
      Discount: invoice.totalDiscount ?? 0,
      RndOffAmt: invoice.roundOff ?? 0,
      TotInvVal: invoice.grandTotal,
    },
  };
}

/* ------------------------------------------------------------------ *
 * GST Rate CRUD
 * ------------------------------------------------------------------ */

export async function listGSTRates(tenant: TenantContext) {
  return GSTRateModel.find(tenantFilter(tenant, {})).sort({ hsnCode: 1 }).lean();
}

export async function upsertGSTRate(
  tenant: TenantContext,
  data: {
    hsnCode: string;
    description?: string;
    cgstPercent: number;
    sgstPercent: number;
    igstPercent: number;
    cessPercent?: number;
  }
) {
  const filter = tenantFilter(tenant, { hsnCode: data.hsnCode.trim().toUpperCase() });
  return GSTRateModel.findOneAndUpdate(
    filter,
    {
      $set: {
        ...data,
        hsnCode: data.hsnCode.trim().toUpperCase(),
        companyId: tenant.companyId,
        isActive: true,
      },
    },
    { upsert: true, new: true, lean: true }
  );
}

export async function updateGSTRate(
  tenant: TenantContext,
  id: string,
  data: Partial<{
    description: string;
    cgstPercent: number;
    sgstPercent: number;
    igstPercent: number;
    cessPercent: number;
    isActive: boolean;
  }>
) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid GST rate id');
  const updated = await GSTRateModel.findOneAndUpdate(
    tenantFilter(tenant, { _id: new Types.ObjectId(id) }),
    { $set: data },
    { new: true, lean: true }
  );
  if (!updated) throw ApiError.notFound('GST rate not found');
  return updated;
}

export async function deleteGSTRate(tenant: TenantContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw ApiError.badRequest('Invalid GST rate id');
  const deleted = await GSTRateModel.findOneAndDelete(
    tenantFilter(tenant, { _id: new Types.ObjectId(id) })
  );
  if (!deleted) throw ApiError.notFound('GST rate not found');
}

/* ------------------------------------------------------------------ *
 * Period label helper
 * ------------------------------------------------------------------ */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatPeriodLabel(period: PeriodQuery): string {
  if (period.month && period.year) {
    return `${MONTHS[period.month - 1]} ${period.year}`;
  }
  const parts: string[] = [];
  if (period.from) parts.push(`from ${period.from.toLocaleDateString('en-IN')}`);
  if (period.to) parts.push(`to ${period.to.toLocaleDateString('en-IN')}`);
  return parts.join(' ') || 'All time';
}
