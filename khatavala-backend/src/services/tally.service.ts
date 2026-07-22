import { ProductModel } from '../models/Product.js';
import { CustomerModel } from '../models/Customer.js';
import { SalesInvoiceModel } from '../models/SalesInvoice.js';
import { tenantFilter, tenantStamp, type TenantContext } from '../middlewares/tenantScope.js';

export interface TallyImportSummary {
  productsImported: number;
  customersImported: number;
  errors: string[];
}

/**
 * Parses Tally XML / CSV data and maps items to Khatavala products & customers.
 */
export async function importTallyData(
  tenant: TenantContext,
  rawContent: string
): Promise<TallyImportSummary> {
  const summary: TallyImportSummary = { productsImported: 0, customersImported: 0, errors: [] };

  // Parse Tally <STOCKITEM> tags
  const stockItemMatches = Array.from(rawContent.matchAll(/<STOCKITEM\s+NAME="([^"]+)">[\s\S]*?<\/STOCKITEM>/gi));
  for (const match of stockItemMatches) {
    const name = match[1];
    const rateMatch = match[0].match(/<OPENINGRATE>.*?(\d+(?:\.\d+)?)/i) || match[0].match(/<RATE>.*?(\d+(?:\.\d+)?)/i);
    const qtyMatch = match[0].match(/<OPENINGBALANCE>.*?(\d+)/i);

    const price = rateMatch ? parseFloat(rateMatch[1]) : 100;
    const stock = qtyMatch ? parseInt(qtyMatch[1], 10) : 10;
    const sku = `TALLY-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      await ProductModel.findOneAndUpdate(
        tenantFilter(tenant, { name }),
        {
          $set: tenantStamp(tenant, {
            name,
            sku,
            sellingPrice: price,
            currentStock: stock,
            isActive: true,
          }),
        },
        { upsert: true, new: true }
      );
      summary.productsImported++;
    } catch (err) {
      summary.errors.push(`Failed to import Tally stock item: ${name}`);
    }
  }

  // Parse Tally <LEDGER> tags for customers
  const ledgerMatches = Array.from(rawContent.matchAll(/<LEDGER\s+NAME="([^"]+)">[\s\S]*?<\/LEDGER>/gi));
  for (const match of ledgerMatches) {
    const name = match[1];
    const phoneMatch = match[0].match(/<MOBILE>(\d+)<\/MOBILE>/i) || match[0].match(/<PHONE>(\d+)<\/PHONE>/i);
    const phone = phoneMatch ? phoneMatch[1] : `98${Math.floor(10000000 + Math.random() * 90000000)}`;

    try {
      await CustomerModel.findOneAndUpdate(
        tenantFilter(tenant, { name }),
        {
          $set: tenantStamp(tenant, {
            name,
            phone,
            isActive: true,
          }),
        },
        { upsert: true, new: true }
      );
      summary.customersImported++;
    } catch (err) {
      summary.errors.push(`Failed to import Tally ledger: ${name}`);
    }
  }

  // If simple CSV format provided
  if (stockItemMatches.length === 0 && ledgerMatches.length === 0) {
    const csvLines = rawContent.split('\n');
    for (const line of csvLines) {
      const parts = line.split(',');
      if (parts.length >= 3 && parts[0].trim() !== 'Name') {
        const name = parts[0].trim();
        const price = parseFloat(parts[1]) || 100;
        const stock = parseInt(parts[2], 10) || 10;

        await ProductModel.findOneAndUpdate(
          tenantFilter(tenant, { name }),
          {
            $set: tenantStamp(tenant, {
              name,
              sku: `CSV-${Math.floor(1000 + Math.random() * 9000)}`,
              sellingPrice: price,
              currentStock: stock,
              isActive: true,
            }),
          },
          { upsert: true, new: true }
        );
        summary.productsImported++;
      }
    }
  }

  return summary;
}

/**
 * Converts Khatavala master data into Tally-compatible XML format.
 */
export async function exportToTallyXml(tenant: TenantContext): Promise<string> {
  const products = await ProductModel.find(tenantFilter(tenant, { isActive: true })).lean();
  const customers = await CustomerModel.find(tenantFilter(tenant, { isActive: true })).lean();
  const invoices = await SalesInvoiceModel.find(tenantFilter(tenant, {})).limit(50).lean();

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n  <HEADER>\n    <TALLYREQUEST>Import Data</TALLYREQUEST>\n  </HEADER>\n  <BODY>\n    <IMPORTDATA>\n      <REQUESTDESC>\n        <REPORTNAME>All Masters</REPORTNAME>\n      </REQUESTDESC>\n      <REQUESTDATA>\n`;

  // Stock Items
  products.forEach((p) => {
    xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n          <STOCKITEM NAME="${p.name}">\n            <NAME>${p.name}</NAME>\n            <RATE>${p.sellingPrice}</RATE>\n            <OPENINGBALANCE>${p.currentStock}</OPENINGBALANCE>\n          </STOCKITEM>\n        </TALLYMESSAGE>\n`;
  });

  // Ledgers
  customers.forEach((c) => {
    xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n          <LEDGER NAME="${c.name}">\n            <NAME>${c.name}</NAME>\n            <PARENT>Sundry Debtors</PARENT>\n            <MOBILE>${c.phone || ''}</MOBILE>\n          </LEDGER>\n        </TALLYMESSAGE>\n`;
  });

  // Sales Vouchers
  invoices.forEach((inv) => {
    xml += `        <TALLYMESSAGE xmlns:UDF="TallyUDF">\n          <VOUCHER VCHTYPE="Sales">\n            <DATE>${inv.date ? new Date(inv.date).toISOString().replace(/-/g, '').slice(0, 8) : ''}</DATE>\n            <VOUCHERNUMBER>${inv.documentNumber}</VOUCHERNUMBER>\n            <AMOUNT>${inv.grandTotal}</AMOUNT>\n          </VOUCHER>\n        </TALLYMESSAGE>\n`;
  });

  xml += `      </REQUESTDATA>\n    </IMPORTDATA>\n  </BODY>\n</ENVELOPE>`;
  return xml;
}
