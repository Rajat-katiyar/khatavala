import { round2 } from '../../src/services/tradeDocument.factory.js';

interface JournalLine {
  debitAmount: number;
  creditAmount: number;
}

function validateJournalBalance(lines: JournalLine[]): { isBalanced: boolean; totalDebit: number; totalCredit: number } {
  const totalDebit = round2(lines.reduce((sum, l) => sum + (l.debitAmount || 0), 0));
  const totalCredit = round2(lines.reduce((sum, l) => sum + (l.creditAmount || 0), 0));
  return {
    isBalanced: Math.abs(totalDebit - totalCredit) < 0.001,
    totalDebit,
    totalCredit,
  };
}

describe('Double-Entry Accounting Unit Tests', () => {
  it('passes validation when total debit equals total credit', () => {
    const lines: JournalLine[] = [
      { debitAmount: 118, creditAmount: 0 },
      { debitAmount: 0, creditAmount: 100 },
      { debitAmount: 0, creditAmount: 18 },
    ];

    const result = validateJournalBalance(lines);
    expect(result.isBalanced).toBe(true);
    expect(result.totalDebit).toBe(118);
    expect(result.totalCredit).toBe(118);
  });

  it('fails validation when debits and credits do not balance', () => {
    const lines: JournalLine[] = [
      { debitAmount: 118, creditAmount: 0 },
      { debitAmount: 0, creditAmount: 100 },
    ];

    const result = validateJournalBalance(lines);
    expect(result.isBalanced).toBe(false);
    expect(result.totalDebit).toBe(118);
    expect(result.totalCredit).toBe(100);
  });

  it('handles multi-line complex transaction balancing', () => {
    const lines: JournalLine[] = [
      { debitAmount: 500, creditAmount: 0 },
      { debitAmount: 500, creditAmount: 0 },
      { debitAmount: 0, creditAmount: 847.46 },
      { debitAmount: 0, creditAmount: 152.54 },
    ];

    const result = validateJournalBalance(lines);
    expect(result.isBalanced).toBe(true);
    expect(result.totalDebit).toBe(1000);
    expect(result.totalCredit).toBe(1000);
  });
});
