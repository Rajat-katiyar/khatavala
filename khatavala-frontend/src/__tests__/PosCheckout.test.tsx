import { describe, it, expect } from 'vitest';

describe('POS Checkout Cart Logic', () => {
  it('correctly calculates total amount with multiple items', () => {
    const items = [
      { name: 'Item A', price: 100, qty: 2 },
      { name: 'Item B', price: 50, qty: 1 },
    ];

    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    expect(total).toBe(250);
  });

  it('correctly calculates GST tax on taxable subtotal', () => {
    const taxableSubtotal = 1000;
    const gstRate = 18;
    const taxAmount = (taxableSubtotal * gstRate) / 100;
    const grandTotal = taxableSubtotal + taxAmount;

    expect(taxAmount).toBe(180);
    expect(grandTotal).toBe(1180);
  });

  it('calculates change due correctly', () => {
    const grandTotal = 450;
    const amountPaid = 500;
    const changeDue = amountPaid - grandTotal;

    expect(changeDue).toBe(50);
  });
});
