# Sales — quotation → order → invoice

Phase 9. Replaces the Phase 4 permission-demo placeholder in `sales.routes.ts`.

## One shape, three documents

A quotation, a sales order and an invoice are the same document at three points
in its life. The structure lives once in [`models/salesDocument.ts`](../src/models/salesDocument.ts),
the CRUD and arithmetic once in [`services/salesDocument.factory.ts`](../src/services/salesDocument.factory.ts),
and the routes once in `sales.routes.ts`. Only two things are genuinely
per-type: the status vocabulary, and what happens on confirmation.

| | Moves stock | Posts to the ledger |
|---|---|---|
| Quotation | no | no |
| Sales order | no | no |
| **Invoice (confirmed)** | **yes** | **yes** |

## The invoice transaction

Confirming an invoice does three things that must all happen or none:

1. the invoice is written / marked posted,
2. stock is deducted for every line (`stock.service`),
3. the customer is debited (`customerLedger.service`).

All three run in **one MongoDB transaction**, opened in `sales.service` and
passed down. A partial application is corruption, not an error: sold goods with
no receivable, or a receivable for goods that never left. Insufficient stock on
any line aborts the whole thing.

Sales never writes `StockLedgerEntry` or `CustomerLedgerEntry` itself — those
collections have a single writer each and Sales is a caller like any other. Both
writers were extended to accept a session for this:
`stock.service.recordMovements(..., { session })` and
`customerLedger.appendEntry(..., { session })`. **When a session is passed,
`appendEntry` skips its manual compensation** — the transaction is the rollback,
and compensating on top would reverse the balance twice.

Verified end-to-end (service level and over HTTP): an invoice for more stock
than exists is rejected with no invoice document, no stock change, and no ledger
entry — including when an earlier line in the same invoice was satisfiable.

## Numbering

`Counter` + `findOneAndUpdate($inc, upsert)`, one counter per
(company, series, financial year). Not `count() + 1`, which double-issues under
concurrency and goes backwards after a cancellation.

**The allocation runs inside the invoice transaction.** Allocating outside would
be faster, but an aborted invoice would consume a number and leave a gap — and
Indian GST requires invoice numbers to be a consecutive serial, so a gap is a
compliance problem. The cost is that concurrent invoices for one company
serialise on the counter document; `withTransaction` retries the write conflicts.
Verified: 15 concurrent invoices produced 15 distinct, consecutive numbers.

## Money

- Every intermediate is rounded to paise (`round2`). Without it a 12-line
  invoice's printed total disagrees with the sum of its printed lines.
- `roundOff` to the nearest rupee is stored as its own visible field, so a
  customer adding up the lines can see where the last few paise went.
- **Totals are stored but never trusted.** The server recomputes every figure
  from the line inputs and its own product master; a client-supplied
  `grandTotal` is ignored (verified over HTTP).
- Line items **snapshot** the product name, SKU and HSN. Renaming a product must
  not retroactively change what an old invoice says was sold.

## Conversion chain

`convertQuotationToOrder`, `convertOrderToInvoice`, `convertQuotationToInvoice`
(counter sales skip the order stage).

Lines are copied **as they stood on the source** — not re-priced from the
product master. A customer who accepted a quotation at last month's price is
entitled to that price. The link is stored on both sides: the new document's
`sourceDocumentId`, the source's `convertedToId` plus a `Converted` status.
Converting twice is refused.

## Editing and cancelling

Editable only while the document has somewhere left to go — a posted invoice and
a converted quotation both refuse edits. Amend by issuing the next document, or
cancel and reissue.

`cancelInvoice` **reverses** rather than deletes: compensating stock movements
and a contra ledger entry, in a transaction. Both ledgers are append-only, so
undo means writing the opposite — and an auditor can still see that an invoice
was raised and then cancelled. Refused if payments exist.

## Placeholders

- **Partial payments** and **returns** were Phase 9 placeholders. Both are real
  as of Phase 10 — see below. `recordPayment` now lives in `payment.service`
  and is re-exported from `sales.service` under its old name.
- **Send by email / WhatsApp** — still a stub, and returns **501**, not a
  200-with-a-lie. A stub reporting success would show the invoice as sent and
  the shop would find out it never was when the customer does not pay.
- **Still open after Phase 10**: customer advances and one payment allocated
  across several invoices (both need an allocation table, so `recordPayment`
  refuses an overpayment rather than silently creating a credit), and stock
  reservation against a confirmed sales order.

## PDF

PDFKit, not Puppeteer: a headless Chromium (~300 MB) plus a live browser process
to lay out a fixed A4 document is the wrong trade. That flips if invoice
templates ever become user-designed HTML.

`GET /api/sales/invoices/:id/pdf` renders inline; `?download=1` forces the save
dialog. Amounts print `Rs.` rather than `₹` — PDFKit's built-in Helvetica is
WinAnsi and renders the rupee glyph as an empty box, which on an invoice looks
like a fault. Fix by embedding a Unicode TTF when this module gets a font asset.

## Model naming

`SalesInvoice.ts` registers the model as **`Invoice`** (collection
`salesinvoices`). Phase 5 fixed that string into `CustomerLedgerEntry`'s
`referenceModel` enum and `refPath`, and mongoose resolves a refPath by model
name — naming it `SalesInvoice` would make `.populate('referenceId')` on a
customer statement silently fail to resolve every invoice row.

## Permissions

`sales.view` / `sales.create` / `sales.update` / `sales.delete`, plus
`sales.void` for cancelling a posted invoice — a heavier act than deleting an
unposted draft, so it gets its own grant.

---

# Phase 10 — POS, payments and reverse transactions

## POS checkout: one call, one transaction

`POST /api/sales/pos/checkout` takes a cart and returns a finished sale. Inside
one transaction: invoice created and posted → stock deducted → customer debited
→ payment recorded → customer credited.

Not for tidiness — for correctness under the conditions a counter runs in. Split
across calls, a dropped connection between "confirm" and "take payment" leaves an
unpaid invoice for goods the customer has already walked out with, and the
operator cannot tell whether to re-charge. One call has one outcome.

It **composes** the existing writers (`sales.service.createInvoiceInSession`,
`payment.service.applyPayment`) rather than reimplementing them. POS is a faster
front door to the same machinery, not a second implementation.

**Walk-in customers**: a sale with no `customerId` resolves to a shared
`Walk-in Customer` row, created on demand. One row rather than thousands of empty
customer records nobody looks up again. The ledger still balances — the walk-in
account is debited by the sale and credited by the payment in the same
transaction, netting to zero for a fully paid cash sale.

## Payments

`payment.service` is now **the only writer** of `Invoice.amountPaid`, replacing
the Phase 9 placeholder. Three things move together in one transaction: the
Payment document, the invoice roll-up and status, and the customer ledger credit.

A payment collection rather than a number on the invoice, because `amountPaid: 4000`
cannot answer *how much came in as cash today*, *which UPI reference matches this
bank line*, or *was it one payment or four*. `mode` is required for the same
reason — cash-up is a daily question. `GET /api/sales/payments/summary` answers it.

**Refunds are new rows flagged `isReversal`**, never edits. Stored as a positive
amount plus a flag rather than a negative amount, so "total received by mode"
reports do not silently net refunds away and understate the till.

One subtlety worth keeping: `refundPayment` posts **no ledger entry**. The credit
note already credited the customer for the full returned value; handing cash back
*settles* that credit rather than creating another. A second entry would credit
the customer twice for one return.

## Returns and credit notes

`SalesReturn` (goods) and `CreditNote` (money) are separate documents because
they answer different questions and do not always correspond. A credit note can
be issued with no goods at all — a post-sale discount, an overcharge, a rate
correction — and GST treats it as a document in its own right with its own series.

Creating a return does four things in one transaction: the return document,
stock IN (unless `restock: false`), the credit note plus its ledger credit, and
optionally cash refunded from the till.

**Partial and repeatable.** The cap on what remains returnable is computed by
summing prior return lines per invoice **line** — via `sourceLineItemId`, not
`productId`, because an invoice can carry the same product on two lines at
different prices and `productId` alone cannot tell them apart.

**Prices come from the invoice**, never the product master: a customer is
credited what they were charged, including that day's discount.

`restock: false` is the damaged-goods path — the customer is still credited in
full, the stock simply does not come back.

## Delivery challans — the double-deduction trap

A challan **deducts stock when dispatched**, because that is when the goods leave.
If it did not, the shop would show items it no longer has for however long it
takes to raise the invoice.

The consequence is the thing to be careful about: **the invoice raised later must
not deduct the same stock again.** That invoice carries `deliveredByChallanId`,
and `sales.service.postInvoice` skips its stock step when it is set — posting the
ledger only. `cancelInvoice` is symmetric: it does not return stock the invoice
never took, because the goods are still with the customer and the challan has to
be cancelled separately.

Get this wrong in either direction and the failure is silent: deduct twice and the
warehouse quietly runs negative; deduct never and it shows goods already on a
lorry. Verified explicitly in both suites ("stock not deducted twice").

## A bug this phase surfaced

`salesDocument.factory.buildPayload` read the customer and company **without the
caller's session**. Outside the session those reads see the pre-transaction
snapshot, so the walk-in customer POS creates and immediately invoices was
invisible — surfacing as "Customer not found" for a customer that demonstrably
existed. Both reads now join the session. Worth remembering for any future writer
that composes inside a transaction: **every read in that path needs the session.**
