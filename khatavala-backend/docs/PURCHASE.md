# Purchases — order → receipt → bill

Phase 11. The buying-side mirror of [SALES.md](./SALES.md), sharing its
machinery rather than copying it.

## What was generalised, not duplicated

Three shared pieces were lifted to serve both trade sides. Each was a rename
plus a parameter, and the Phase 9/10 call sites are unchanged (the old names are
re-exported):

| Was | Now | Parameter added |
|---|---|---|
| `models/salesDocument.ts` | `models/tradeDocument.ts` | `party` — customer or supplier |
| `services/salesDocument.factory.ts` | `services/tradeDocument.factory.ts` | `party` — model, id field, name field |
| `services/payment.service.ts` (Phase 10) | `services/payment.factory.ts` + two thin services | `direction` — which ledger column |

The alternative was a second hand-maintained copy of each. The refund rule, the
overpayment guard and the paise-rounding are exactly the things that drift when
copied — and the sales suites (66/66) were re-run after the refactor to prove
nothing moved.

## The asymmetry that matters: which document moves stock

| | Moves stock | Posts to a ledger |
|---|---|---|
| Purchase order | no | no |
| **Goods receipt (GRN)** | **yes — IN** | no |
| **Purchase bill** | no* | **yes — CREDITS the supplier** |
| **Debit note (return)** | **yes — OUT** | **yes — DEBITS the supplier** |

\* unless it is a standalone bill with no GRN behind it (`receivesStock: true`).

This is the mirror of the selling side, not a copy of it: there, the **invoice**
moves stock (unless a delivery challan already did). Here the **receipt** does,
and the bill that follows moves none.

That asymmetry is real. On the selling side the common case is bill-and-hand-over
together; on the buying side goods arrive on a lorry days before the supplier's
bill does. Each side attaches the movement to the document that actually
coincides with the goods.

**A bill against a GRN that also claims `receivesStock` is rejected**, not
silently half-applied — a caller who believes the goods will be taken in twice
should be told, not quietly given one of the two.

## Why receipt is a separate document from the order

Because what arrives is routinely not what was ordered. A supplier ships 36 of
40, or delivers the balance a week later, or sends 40 and 4 are damaged. If
receiving were just "mark the PO received", none of that could be recorded and
stock would be wrong by exactly the amount nobody checked.

So a GRN line's `quantity` is the **accepted** quantity — what enters stock —
with `orderedQuantity` and `rejectedQuantity` beside it recording the
discrepancy. The bill that follows is raised for what was **accepted**, never
what was ordered: rejected units were never taken into stock and must not be
paid for.

**Order progress is derived, not incremented.** `updateOrderProgress` re-sums
the receipts inside the transaction; a counter on the order would need unwinding
on every cancellation and would lose races between concurrent receipts.

## Ledger direction

A supplier is a **creditor**, so the signs invert against the selling side:

- a bill **CREDITS** the supplier — increases the payable
- a payment **DEBITS** them — reduces it
- a debit note **DEBITS** them — reduces it

Booking any of these the other way would make every payables report read
inverted, which is why `direction` is a required parameter of the shared payment
engine rather than a line each service writes for itself. Same call
`ledger.factory.ts` made in Phase 5/6.

## Unit price is required

Unlike the sales side, which defaults to the product's `sellingPrice`, a
purchase line **must** state `unitPrice`. There is no honest default: the
product master's `purchasePrice` is what we paid *last* time, and billing this
order at last quarter's rate would be wrong far more often than right. The
supplier's rate is on their quotation and has to be typed.

## Returns

One document (`DebitNote`), not the SalesReturn/CreditNote pair. The split on the
selling side exists because a credit note is routinely issued with no goods —
a post-sale discount, an overcharge. On the buying side the goods-and-money event
is almost always the same event, and a purely financial debit note (a rate
correction) is expressible with `returnsStock: false`, so a second collection
would earn nothing.

Partial and repeatable, capped per bill **line** via `sourceLineItemId` — same
reasoning as sales returns: one bill can carry the same product twice at
different rates.

## A bug this phase surfaced

`buildLineItems` silently dropped `sourceLineItemId`, `orderedQuantity` and
`rejectedQuantity` — it rebuilt each line from scratch and only kept the fields
it knew about. Nothing failed loudly. What happened instead: order-progress
matching fell back to `productId`, which never matches an order line's `_id`, so
**every order stayed `PartiallyReceived` forever and every follow-up receipt
re-offered the full quantity**. Four tests caught it; the fix is a carry-through
in the shared factory with a comment explaining what it costs to lose.

Worth remembering: when a shared builder reconstructs a document from inputs,
anything it does not explicitly carry is silently discarded.

## Permissions

The `purchases` module has been in the catalog since Phase 4 and until now gated
nothing. `view` / `create` / `update` / `delete`, with `delete` covering returns
and cancellations — the heavier acts, mirroring `sales.void`.
