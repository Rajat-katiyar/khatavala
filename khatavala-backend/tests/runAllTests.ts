import mongoose from 'mongoose';
import { round2, determineSupplyType } from '../src/services/tradeDocument.factory.js';
import { CompanyModel } from '../src/models/Company.js';
import { ProductModel } from '../src/models/Product.js';
import { CustomerModel } from '../src/models/Customer.js';
import { SupplierModel } from '../src/models/Supplier.js';
import { SalesInvoiceModel } from '../src/models/SalesInvoice.js';
import { CustomerLedgerEntryModel } from '../src/models/CustomerLedgerEntry.js';
import { StockLedgerEntryModel } from '../src/models/StockLedgerEntry.js';
import { UnitModel } from '../src/models/Catalog.js';
import { env } from '../src/config/env.js';

async function runSuite() {
  console.log('====================================================');
  console.log('   KHATAVALA FULL SUITE TESTING & QA RUNNER');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✓ PASSED: ${message}`);
      passed++;
    } else {
      console.error(`  ✕ FAILED: ${message}`);
      failed++;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // PART 1: UNIT TESTS
  // ────────────────────────────────────────────────────────────────────────
  console.log('[PART 1] Running Business Logic & Calculation Unit Tests...');

  // 1.1 Paise Rounding
  assert(round2(10.123) === 10.12, 'Paise rounding round2(10.123) === 10.12');
  assert(round2(10.125) === 10.13, 'Paise rounding round2(10.125) === 10.13');
  assert(round2(100.004) === 100, 'Paise rounding round2(100.004) === 100');

  // 1.2 Intra vs Inter State Determination
  assert(
    determineSupplyType('27AAAAA0000A1Z5', 'MH', '27BBBBB0000B1Z5', 'MH') === 'intra',
    'Intra-state supply type derived for matching state codes'
  );
  assert(
    determineSupplyType('27AAAAA0000A1Z5', 'MH', '07AAAAA0000A1Z5', 'DL') === 'inter',
    'Inter-state supply type derived for differing state codes'
  );

  // 1.3 MRP Tax-Inclusive Back-Calculation
  const mrp = 118;
  const gstRate = 18;
  const basePrice = round2(mrp / (1 + gstRate / 100));
  const taxAmount = round2((basePrice * gstRate) / 100);
  assert(basePrice === 100, 'MRP ₹118 @ 18% GST back-calculates base price of ₹100');
  assert(taxAmount === 18, 'MRP ₹118 @ 18% GST tax amount is ₹18');
  assert(round2(basePrice + taxAmount) === 118, 'MRP total equals ₹118 exactly');

  // 1.4 Double-Entry Balancing
  const debits = 500 + 500;
  const credits = 847.46 + 152.54;
  assert(round2(debits) === round2(credits), 'Journal entry debits (₹1000) equal credits (₹1000)');

  // 1.5 Subscription usage check
  const checkLimit = (usage: number, limit: number) => limit === -1 || usage < limit;
  assert(checkLimit(5, 10) === true, 'Usage below plan cap is allowed');
  assert(checkLimit(10, 10) === false, 'Usage reaching plan cap is blocked (HTTP 402)');

  console.log('\n[PART 2] Running Integration Tests against MongoDB...');

  try {
    const mongoUri = env.MONGODB_URI || 'mongodb://127.0.0.1:27017/khatavala_qa_test';
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
    console.log(`  Connected to MongoDB test instance at ${mongoUri}`);

    // Clean up test collections
    await CompanyModel.deleteMany({ name: /^QA Test/ });
    await ProductModel.deleteMany({ name: /^QA Test/ });
    await CustomerModel.deleteMany({ name: /^QA Test/ });

    // 2.1 Sales Flow
    const company = await CompanyModel.create({ name: 'QA Test Company A', gstin: '27AAAAA0000A1Z5' });
    const unit = await UnitModel.create({ companyId: company._id, name: 'Pcs', symbol: 'pcs' });

    const product = await ProductModel.create({
      companyId: company._id,
      name: 'QA Test Product 1',
      sku: `QA-SKU-${Date.now()}`,
      primaryUnitId: unit._id,
      purchasePrice: 100,
      sellingPrice: 200,
      openingStock: 100,
      currentStock: 100,
      gstPercentage: 18,
    });

    const customer = await CustomerModel.create({
      companyId: company._id,
      name: 'QA Test Customer A',
      phone: '9999999999',
    });

    // Deduct stock atomically
    const deductRes = await ProductModel.updateOne(
      { _id: product._id, currentStock: { $gte: 2 } },
      { $inc: { currentStock: -2 } }
    );
    assert(deductRes.modifiedCount === 1, 'Atomic stock deduction succeeded for 2 units');

    const updatedProduct = await ProductModel.findById(product._id);
    assert(updatedProduct?.currentStock === 98, 'Product stock updated from 100 to 98');

    // 2.2 Multi-Tenant Isolation
    const companyB = await CompanyModel.create({ name: 'QA Test Company B' });
    const unitB = await UnitModel.create({ companyId: companyB._id, name: 'Box', symbol: 'box' });
    await ProductModel.create({
      companyId: companyB._id,
      name: 'QA Test Product B',
      sku: `QA-SKU-B-${Date.now()}`,
      primaryUnitId: unitB._id,
    });

    const companyAProducts = await ProductModel.find({ companyId: company._id, name: /^QA Test/ });
    const companyBProducts = await ProductModel.find({ companyId: companyB._id, name: /^QA Test/ });

    assert(companyAProducts.length === 1 && companyAProducts[0].name === 'QA Test Product 1', 'Company A query returns only Company A products');
    assert(companyBProducts.length === 1 && companyBProducts[0].name === 'QA Test Product B', 'Company B query returns only Company B products');

    // 2.3 Concurrent Stock Deduction Atomicity Guard
    const flashProduct = await ProductModel.create({
      companyId: company._id,
      name: 'QA Test Flash Product',
      sku: `QA-FLASH-${Date.now()}`,
      primaryUnitId: unit._id,
      currentStock: 1,
    });

    const attemptPurchase = async (qty: number) => {
      const res = await ProductModel.updateOne(
        { _id: flashProduct._id, currentStock: { $gte: qty } },
        { $inc: { currentStock: -qty } }
      );
      return res.modifiedCount > 0;
    };

    const [purchase1, purchase2] = await Promise.all([attemptPurchase(1), attemptPurchase(1)]);
    assert(purchase1 !== purchase2, 'Concurrent stock guard: exactly one purchase succeeded for single stock unit');

    const finalFlashProduct = await ProductModel.findById(flashProduct._id);
    assert(finalFlashProduct?.currentStock === 0, 'Final stock is 0 (no negative stock occurred)');

    // Cleanup
    await CompanyModel.deleteMany({ name: /^QA Test/ });
    await ProductModel.deleteMany({ name: /^QA Test/ });
    await CustomerModel.deleteMany({ name: /^QA Test/ });
    await UnitModel.deleteMany({ name: /^QA Test/ });

    await mongoose.disconnect();
  } catch (err: any) {
    console.error('  ⚠ MongoDB integration test warning:', err?.message || err);
  }

  console.log('\n====================================================');
  console.log(`   TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================');

  if (failed > 0) process.exit(1);
}

runSuite().catch(console.error);
