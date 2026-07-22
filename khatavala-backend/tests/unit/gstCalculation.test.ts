import { round2, determineSupplyType } from '../../src/services/tradeDocument.factory.js';

describe('GST Calculation & Rounding Unit Tests', () => {
  describe('round2() Paise Rounding', () => {
    it('rounds paise to exactly 2 decimal places', () => {
      expect(round2(10.123)).toBe(10.12);
      expect(round2(10.125)).toBe(10.13);
      expect(round2(10.128)).toBe(10.13);
      expect(round2(100.004)).toBe(100);
      expect(round2(0.005)).toBe(0.01);
    });

    it('avoids floating point arithmetic drift', () => {
      const line1 = round2(118.00 / 1.18); // 100
      const line2 = round2(100 * 0.18);     // 18
      expect(line1 + line2).toBe(118.00);
    });
  });

  describe('determineSupplyType() Intra vs Inter-State', () => {
    it('returns intra when state codes match', () => {
      expect(determineSupplyType('27AAAAA0000A1Z5', 'Maharashtra', '27BBBBB0000B1Z5', 'Maharashtra')).toBe('intra');
    });

    it('returns inter when state codes differ', () => {
      expect(determineSupplyType('27AAAAA0000A1Z5', 'Maharashtra', '07AAAAA0000A1Z5', 'Delhi')).toBe('inter');
    });

    it('defaults to intra when state or GSTIN is missing', () => {
      expect(determineSupplyType(null, 'Maharashtra', null, null)).toBe('intra');
      expect(determineSupplyType(undefined, undefined, undefined, undefined)).toBe('intra');
    });
  });

  describe('MRP Tax-Inclusive Back-Calculation', () => {
    it('correctly back-calculates base price from MRP (18% GST)', () => {
      const mrp = 118;
      const gstRate = 18;
      const basePrice = round2(mrp / (1 + gstRate / 100));
      const taxAmount = round2((basePrice * gstRate) / 100);
      const grandTotal = round2(basePrice + taxAmount);

      expect(basePrice).toBe(100);
      expect(taxAmount).toBe(18);
      expect(grandTotal).toBe(118);
    });

    it('correctly back-calculates base price from MRP (5% GST)', () => {
      const mrp = 105;
      const gstRate = 5;
      const basePrice = round2(mrp / (1 + gstRate / 100));
      const taxAmount = round2((basePrice * gstRate) / 100);
      const grandTotal = round2(basePrice + taxAmount);

      expect(basePrice).toBe(100);
      expect(taxAmount).toBe(5);
      expect(grandTotal).toBe(105);
    });

    it('correctly back-calculates base price for complex MRP figures', () => {
      const mrp = 499;
      const gstRate = 12;
      const basePrice = round2(mrp / (1 + gstRate / 100)); // 445.54
      const taxAmount = round2((basePrice * gstRate) / 100); // 53.46
      const grandTotal = round2(basePrice + taxAmount); // 499.00

      expect(grandTotal).toBe(mrp);
    });
  });
});
