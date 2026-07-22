# Accounting — double entry under Sales and Purchase

Phase 12. Replaces the Phase 4 permission-demo placeholder in
`accounting.routes.ts`.

## The rule

**`journal.service.postJournal` is the only writer of `JournalEntry`**, and
every automatic posting happens **inside the transaction of the operation that
caused it**. That is the whole design: the books cannot drift from the
documents, because there is no moment where one exists without the other. If the
journal will not balance, the invoice does not post either.

| Trigger | Posted by | In the same transaction as |
|---|---|---|
| Sales invoice confirmed | `postSalesInvoiceJournal` | `sales.service.postInvoice` |
| Purchase bill confirmed | `postPurchaseInvoiceJournal` | `purchase.service.postPurchaseInvoice` |
| Customer receipt | `postReceiptJournal` | `payment.factory.applyPayment` |
| Supplier payment | `postSupplierPaymentJournal` | same engine, other direction |
| Sales return | `postCreditNoteJournal` | `salesReturn.service` |
| Purchase return | `postDebitNoteJournal` | `purchaseReturn.service` |
| Invoice/bill cancelled | `reverseJournalsFor` | the cancel transaction |

There is deliberately **no route** that posts a journal for an invoice or a
payment. Exposing one would let the books be edited out from under the
documents — the exact drift this module prevents. Writable by hand: the chart of
accounts, manual journals, and contra entries.

## The balance rule

`sum(debit) === sum(credit)`, checked in the service **before** the write.

A mongoose validator could check it too, and the model documents the invariant —
but a validator only rejects a bad write. `postJournal` makes bad writes
unconstructible: every posting function builds lines and hands them here, so the
check sits on the *only* path in. Compared with a half-paisa tolerance, never
`===`: a sum of six rounded figures can land a hair off, and refusing a real
invoice over 0.0001 would be worse than useless.

## The postings

```
Sales invoice     Dr Accounts Receivable  total
                    Cr Sales                net of tax
                    Cr GST Payable          tax
                    ± Rounding Difference

Customer receipt  Dr Cash / Bank          amount
                    Cr Accounts Receivable  amount        ← NO income leg

Purchase bill     Dr Purchases            net of tax
                  Dr GST Receivable       tax
                    Cr Accounts Payable     total

Supplier payment  Dr Accounts Payable     amount
                    Cr Cash / Bank          amount

Credit note       Dr Sales Returns        net of tax
                  Dr GST Payable          tax
                    Cr Accounts Receivable  total

Debit note        Dr Accounts Payable     total
                    Cr Purchase Returns     net of tax
                    Cr GST Receivable       tax
```

Two things worth stating plainly:

**A receipt books no income.** The sale was recognised when the invoice was
raised. Booking it again on payment double-counts every credit sale — the
classic cash-vs-accrual error.

**GST is never income.** It is split into OUTPUT (collected on sales — a
liability, we owe the government) and INPUT (paid on purchases — an asset, it
offsets what we owe). Netting them into one account is the most common mistake
in a small accounting build: the two are reported separately on every GST
return, and once merged they cannot be separated again.

**Round-off gets its own leg** rather than being absorbed into sales. The
invoice's `grandTotal` is rounded to the rupee, so `taxable + tax ≠ total`;
without a rounding line the entry would not balance, and hiding it in income
would misstate revenue by a few paise per invoice forever.

## The chart of accounts

Twelve system accounts and six groups. Deliberately small — a fifty-account
default chart is one nobody reads and everybody works around.

Accounts the posting service needs are found by **`systemKey`**, not by name, so
a user can rename "Sales" to "Revenue from Operations" and the postings still
land correctly. `systemKey` and `isSystem` are absent from the create/update
validators: a client that could set them could redirect every sales posting into
an account of its choosing.

`accountType` decides which side increases the balance (`normalBalanceOf`), so a
system account **cannot be retyped** — that would silently flip the sign of every
figure already posted into it. Accounts with postings are **deactivated, not
deleted**.

### Seeding is lazy, and that is on purpose

`ensureDefaultAccounts` is idempotent and runs on **every posting**, not once at
signup. A company created before this phase has no chart, and the first sale
after deploying must not fail with "no such account". Seeding inside the posting
transaction means accounting starts working for every existing tenant the moment
they next transact — no migration, and no window where an invoice is rejected
for a bookkeeping reason the user cannot act on.

`npm run db:seed-accounts` exists so an operator can populate the chart up front
and let users rename and extend it before trading. It is optional.

## Reports

`getAccountLedger`, `getCashBook`, `getBankBook` and `getTrialBalance` are one
aggregation shape over different account sets: unwind the lines, keep the ones
touching the accounts in question, order, and run a balance down the column.

Two details that are easy to get wrong:

- **The `$match` is applied again after `$unwind`.** The entry matched because
  *some* line touched the account; the others belong to different accounts.
- **The opening balance is computed separately.** A date-filtered ledger whose
  first row starts at zero silently claims the account was empty on that date.

The cash and bank books resolve their accounts by system key **plus children**,
so a company that adds "HDFC Current A/c" under Bank sees it in the bank book
without configuring anything.

`getTrialBalance` is the health check: if total debits ≠ total credits, an
unbalanced entry exists and every other report is suspect. `postJournal` is
supposed to make that impossible; the report proves it.

## Verified

76 service-level checks and 48 over authenticated HTTP, against throwaway
databases. Both confirm the deliverable directly: a sales invoice and a payment
each produce one balanced journal entry, with the right accounts on the right
sides, visible in the account ledger and cash book with a correct running
balance — and the trial balance still balances after invoices, bills, payments,
returns, contra entries and a cancellation-reversal.

The Sales/POS (66) and Purchase (62) suites were re-run afterwards, since this
phase modified the payment engine and both invoice-posting paths. No regressions.
