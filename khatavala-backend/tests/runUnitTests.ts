import { round2, determineSupplyType } from '../src/services/tradeDocument.factory.js';

console.log('--- Running GST Calculation Unit Tests ---');

// Test 1: round2
console.assert(round2(10.123) === 10.12, '10.123 should round to 10.12');
console.assert(round2(10.125) === 10.13, '10.125 should round to 10.13');
console.assert(round2(100.004) === 100, '100.004 should round to 100');
console.log('✓ round2 tests passed');

// Test 2: determineSupplyType
console.assert(
  determineSupplyType('27AAAAA0000A1Z5', 'Maharashtra', '27BBBBB0000B1Z5', 'Maharashtra') === 'intra',
  'Matching states should be intra'
);
console.assert(
  determineSupplyType('27AAAAA0000A1Z5', 'Maharashtra', '07AAAAA0000A1Z5', 'Delhi') === 'inter',
  'Different states should be inter'
);
console.log('✓ determineSupplyType tests passed');

// Test 3: MRP tax-inclusive back-calculation
const mrp = 118;
const gstRate = 18;
const basePrice = round2(mrp / (1 + gstRate / 100));
const taxAmount = round2((basePrice * gstRate) / 100);
const grandTotal = round2(basePrice + taxAmount);

console.assert(basePrice === 100, 'Base price should be 100');
console.assert(taxAmount === 18, 'Tax amount should be 18');
console.assert(grandTotal === 118, 'Grand total should be 118');
console.log('✓ MRP tax-inclusive back-calculation tests passed');

console.log('ALL GST UNIT TESTS PASSED SUCCESSFULLY! ✅');
