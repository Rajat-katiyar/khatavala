# Inventory / stock engine

Phase 8. Read this before writing anything that changes stock — Sales and
Purchase both will.

## The rule

**`stock.service.recordMovement` is the only thing that may change stock.**
Nothing else writes `StockBalance`, `StockLedgerEntry` or `Product.currentStock`.
A second writer breaks the invariant the whole module rests on:

```
StockBalance.quantity
  === sum(StockLedgerEntry.quantity) for that product+warehouse+batch
  === runningBalance on the newest entry
```

`GET /api/inventory/verify` re-derives every balance from the ledger and reports
disagreements. It should always come back `ok: true`.

## Two collections, two jobs

| | `StockLedgerEntry` | `StockBalance` |
|---|---|---|
| What | Every movement, ever | Current quantity per product+warehouse+batch |
| Written | Append-only. Never updated, never deleted | `$inc` only |
| Answers | "What happened, and when?" | "How many do we have?" |

The balance is derivable from the ledger — that is what makes the design
auditable — but deriving it costs O(movements) per read, so it is maintained.
Both are written in one transaction, so they cannot drift.

Correcting a mistake means **appending a compensating Adjustment**, never
editing a row. Editing would silently invalidate `runningBalance` on every later
entry, and the point of a ledger is that you can't.

## Why it is safe under concurrency

1. **`$inc`, never read-then-write.** Two concurrent sales that both read
   `quantity: 10`, both compute 9, and both write 9 have sold one unit twice.
   `$inc` does the arithmetic server-side, atomically; `new: true` returns the
   post-update figure, which becomes the entry's `runningBalance`. The two
   collections agree because the number came from the same operation.
2. **A transaction** around the balance write and the ledger insert (and around
   both legs of a transfer). Requires the replica-set MongoDB from Phase 1 —
   `docker compose up -d mongo`. A standalone mongod returns a clear
   `REPLICA_SET_REQUIRED` error rather than a cryptic driver message.
3. **The negative check runs *after* the increment**, inside the transaction.
   Checking first is a read-then-write with a race in the gap; applying the
   delta and aborting if it went below zero is the same check with no gap.

Verified end-to-end against a replica set: 100 concurrent single-unit removals
land 100 distinct running balances with no lost updates; 30 concurrent requests
for 100 units against 715 on hand grant exactly 7 and reject 23 without ever
going negative; 50 concurrent two-leg transfers all commit; a transfer that
fails its source leg leaves no orphan credit on the destination.

### Floating point

Quantities are IEEE doubles and stock is legitimately fractional (1.5 kg). A
balance built from hundreds of `$inc`s of 0.2 lands on 204.99999999999943 where
summing the same rows in one `$group` gives 205 — same numbers, different order
of addition. `verifyBalances` therefore compares within `1e-6`: far below any
real stock unit, far above the accumulated error, so a genuinely lost movement
(off by a whole unit at least) still trips it.

## Calling it from Sales / Purchase

Pass your own session and the movements join your transaction — the invoice, the
customer ledger entry and the stock all commit or all fail:

```ts
const session = await mongoose.startSession();
await session.withTransaction(async () => {
  const invoice = await InvoiceModel.create([...], { session });
  await stockService.recordMovements(
    tenant,
    lines.map((line) => ({
      productId: line.productId,
      warehouseId: invoice.warehouseId,
      movementType: 'Out',
      quantity: -line.quantity,      // signed: negative leaves the warehouse
      referenceType: 'Sale',
      referenceId: invoice._id,
    })),
    { session }
  );
  await customerLedger.appendEntry(tenant, { /* … */ });
});
```

With a session passed in, this module will not commit and will not retry — the
outer transaction owns both.

## Sign convention

`quantity` is the **signed delta**: positive in, negative out. `runningBalance`
is then a plain running sum a reader can verify by eye. Callers that think in
magnitudes (`transferStock`, `recordDamage`) negate at their own boundary, where
the direction is obvious; the UI splits the sign back into In/Out columns.

## Permissions

- `inventory.view` — stock levels, movement history, reconciliation
- `inventory.create` — opening stock, transfers, warehouse creation
- `inventory.adjust` — adjustments and damage write-offs

`adjust` is deliberately separate: adjustments and damage are how stock
disappears without a sale, which is exactly what an internal-control review
looks at. A role that can move stock is not automatically one that can make it
vanish.

## Tenancy

Every collection here is tenant-scoped and every query goes through
`tenantFilter` / `tenantStamp` — see [TENANCY.md](./TENANCY.md). Note the upsert
in `recordMovement` stamps the active `companyId` onto any row it creates, so
product and warehouse existence are checked against the tenant *first*.
