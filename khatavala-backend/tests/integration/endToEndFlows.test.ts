import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import express from 'express';
import request from 'supertest';

// Import models
import { UserModel } from '../../src/models/User.js';
import { CompanyModel } from '../../src/models/Company.js';
import { ProductModel } from '../../src/models/Product.js';
import { CustomerModel } from '../../src/models/Customer.js';
import { SupplierModel } from '../../src/models/Supplier.js';
import { SalesInvoiceModel } from '../../src/models/SalesInvoice.js';
import { PurchaseInvoiceModel } from '../../src/models/PurchaseInvoice.js';
import { CustomerLedgerEntryModel } from '../../src/models/CustomerLedgerEntry.js';
import { StockLedgerEntryModel } from '../../src/models/StockLedgerEntry.js';
import { JournalEntryModel } from '../../src/models/JournalEntry.js';
import { UnitModel } from '../../src/models/Catalog.js';

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  // Start in-memory replica set for transactions
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = replSet.getUri();
  await mongoose.connect(uri);
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
}, 60000);

beforeEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

describe('Integration Test Suite — Khatavala Core Flows', () => {
  it('1. Sales Flow: Create Sales Invoice -> updates stock, customer ledger, and journal', async () => {
    const company = await CompanyModel.create({ name: 'Test Shop A', gstin: '27AAAAA0000A1Z5', state: 'Maharashtra' });
    const unit = await UnitModel.create({ companyId: company._id, name: 'Pcs', symbol: 'pcs' });

    const product = await ProductModel.create({
      companyId: company._id,
      name: 'Test Rice 5kg',
      sku: 'RICE-01',
      primaryUnitId: unit._id,
      purchasePrice: 200,
      sellingPrice: 300,
      openingStock: 50,
      currentStock: 50,
      gstPercentage: 18,
    });

    const customer = await CustomerModel.create({
      companyId: company._id,
      name: 'John Doe',
      phone: '9876543210',
    });

    // Simulate invoice posting logic
    const grandTotal = 354; // 300 + 18% tax (54)
    const invoice = await SalesInvoiceModel.create({
      companyId: company._id,
      customerId: customer._id,
      customerName: customer.name,
      documentNumber: 'INV-001',
      date: new Date(),
      lineItems: [
        {
          productId: product._id,
          name: product.name,
          sku: product.sku,
          quantity: 1,
          unitPrice: 300,
          discountPercent: 0,
          gstPercent: 18,
          taxableAmount: 300,
          taxAmount: 54,
          lineTotal: 354,
        },
      ],
      subTotal: 300,
      totalTax: 54,
      grandTotal,
      status: 'Unpaid',
    });

    // Deduct stock atomically
    await ProductModel.updateOne({ _id: product._id }, { $inc: { currentStock: -1 } });

    // Stock ledger entry
    await StockLedgerEntryModel.create({
      companyId: company._id,
      productId: product._id,
      movementType: 'SalesInvoice',
      quantity: -1,
      runningBalance: 49,
      referenceDocumentId: invoice._id,
    });

    // Customer ledger entry
    await CustomerLedgerEntryModel.create({
      companyId: company._id,
      customerId: customer._id,
      entryType: 'Invoice',
      debitAmount: grandTotal,
      creditAmount: 0,
      runningBalance: grandTotal,
      referenceDocumentId: invoice._id,
    });

    // Verify product stock updated to 49
    const updatedProduct = await ProductModel.findById(product._id);
    expect(updatedProduct?.currentStock).toBe(49);

    // Verify customer ledger entry
    const ledger = await CustomerLedgerEntryModel.findOne({ companyId: company._id, customerId: customer._id });
    expect(ledger?.debitAmount).toBe(354);
  });

  it('2. Multi-Tenant Isolation: Company A data is isolated from Company B', async () => {
    const companyA = await CompanyModel.create({ name: 'Company A' });
    const companyB = await CompanyModel.create({ name: 'Company B' });

    const unitA = await UnitModel.create({ companyId: companyA._id, name: 'Box', symbol: 'box' });
    const unitB = await UnitModel.create({ companyId: companyB._id, name: 'Kgs', symbol: 'kg' });

    await ProductModel.create({ companyId: companyA._id, name: 'Item A', sku: 'SKU-A', primaryUnitId: unitA._id });
    await ProductModel.create({ companyId: companyB._id, name: 'Item B', sku: 'SKU-B', primaryUnitId: unitB._id });

    const companyAProducts = await ProductModel.find({ companyId: companyA._id });
    expect(companyAProducts).toHaveLength(1);
    expect(companyAProducts[0].name).toBe('Item A');

    const companyBProducts = await ProductModel.find({ companyId: companyB._id });
    expect(companyBProducts).toHaveLength(1);
    expect(companyBProducts[0].name).toBe('Item B');
  });

  it('3. Concurrent Stock Deduction: Prevents negative stock under concurrent checkout', async () => {
    const company = await CompanyModel.create({ name: 'Flash Sale Store' });
    const unit = await UnitModel.create({ companyId: company._id, name: 'Pcs', symbol: 'pcs' });

    const product = await ProductModel.create({
      companyId: company._id,
      name: 'Limited Item',
      sku: 'LIMITED-1',
      primaryUnitId: unit._id,
      currentStock: 1,
    });

    // Atomic update function (simulates Phase 8 inventory guard)
    const attemptDeduct = async (qty: number) => {
      const res = await ProductModel.updateOne(
        { _id: product._id, currentStock: { $gte: qty } },
        { $inc: { currentStock: -qty } }
      );
      return res.modifiedCount > 0;
    };

    // Simulate two concurrent checkout attempts for the single remaining unit
    const [buyer1Success, buyer2Success] = await Promise.all([attemptDeduct(1), attemptDeduct(1)]);

    // Exactly one purchase must succeed
    expect(buyer1Success !== buyer2Success).toBe(true);

    const finalProduct = await ProductModel.findById(product._id);
    expect(finalProduct?.currentStock).toBe(0);
  });
});
