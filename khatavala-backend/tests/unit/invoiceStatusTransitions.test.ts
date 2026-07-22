import { INVOICE_STATUSES, type InvoiceStatus } from '../../src/models/SalesInvoice.js';

describe('Invoice Status Transitions Unit Tests', () => {
  const getNextStatus = (amountDue: number, grandTotal: number, currentStatus: InvoiceStatus): InvoiceStatus => {
    if (currentStatus === 'Cancelled') return 'Cancelled';
    if (amountDue <= 0) return 'Paid';
    if (amountDue < grandTotal) return 'PartiallyPaid';
    return 'Unpaid';
  };

  it('transitions from Unpaid to PartiallyPaid on partial payment', () => {
    expect(getNextStatus(500, 1000, 'Unpaid')).toBe('PartiallyPaid');
  });

  it('transitions to Paid when amount standard balance reaches zero', () => {
    expect(getNextStatus(0, 1000, 'PartiallyPaid')).toBe('Paid');
  });

  it('remains Unpaid when no payment has been made', () => {
    expect(getNextStatus(1000, 1000, 'Draft')).toBe('Unpaid');
  });

  it('remains Cancelled if invoice was cancelled', () => {
    expect(getNextStatus(0, 1000, 'Cancelled')).toBe('Cancelled');
  });
});
