# Financial reporting

Phase 13. Four statements over the Phase 12 accounting engine, plus drill-down
and exports. Read-only throughout — nothing here writes, and there is no way to
"adjust" a report without posting a journal that explains the adjustment.

## One computation, four reports

All four derive from `accountBalances`: unwind the journal lines, bucket by
account, net each bucket toward its account's normal side. Three hand-written
pipelines would drift the first time someone changed how a contra account is
treated.

## The identity they rest on

Every journal entry balances (enforced in `journal.service`), so summing every
line gives total debits === total credits. Netting each account toward its own
normal side, that rearranges to:

```
A + X = L + E + I        (debit-normal totals = credit-normal totals)
A     = L + E + (I − X)
A     = L + E + Profit
```

So **the balance sheet balances because the trial balance does**, and retained
earnings is not a stored figure — it is the P&L result to date. Nothing closes
the books into an equity account, because that would create a second place for
the same number to live and a way for the two to disagree.

The consequence is the reconciliation this phase was asked to demonstrate:
**P&L net profit and balance-sheet retained earnings are the same figure by
construction, not by agreement.** Both suites assert it directly.

## The P&L subtlety worth knowing

`Sales Returns` is *typed* as an Expense (so a debit increases it) and
`Purchase Returns` as Income (mirror reason) — see `account.service`. Grouping
the statement naively by account type would therefore print **purchase returns
as revenue** and **sales returns as an operating cost**. Both wrong, and both
plausible enough to go unnoticed.

So the statement is built by ROLE: revenue nets against sales returns, cost of
sales against purchase returns. The bottom line is identical either way — this
only changes which section each figure appears in, which is exactly what a
reader relies on. The service test asserts net profit still equals the naive
`total income − total expenses`, so the sectioning can never silently change a
total.

## Drill-down

Reports carry a **key**, not a list of ids: `{ accountId, from, to, entryCount }`.
A Sales line on an annual P&L can be the sum of tens of thousands of entries;
embedding those ids would make the summary larger than the detail it summarises,
for a list the client discards unless the user clicks. `GET /reports/drill-down`
returns the transactions when asked.

Every drill-down row carries `sourceType` / `sourceId` / `sourceNumber`, so
clicking through lands on the **invoice or payment**, not merely on a journal
voucher — "why is receivables 8,250?" is answered by the invoice.

## Exports

One PDF renderer and one Excel renderer for all four reports. Each report is
flattened into a common `ReportDocument` (title, period, sections of labelled
rows, totals); eight bespoke renderers would be eight places to fix the next
alignment bug.

PDFKit rather than Puppeteer, as elsewhere. In Excel, money stays a **number**
with a cell format rather than a formatted string — otherwise the one thing
people open Excel to do, add a column up, is impossible.

`GET /reports/:kind/export?format=pdf|xlsx`, gated on `reports.export` so "can
read on screen" and "can take a copy out of the building" stay separable. An
unknown `:kind` is a 404 rather than falling through to the wrong statement.

## Two bugs this phase surfaced

**An unfiltered day book crashed.** `getDayBook` passed `{ date: {} }` when given
no dates — mongoose casts that to a Date and throws. The other reports guarded
it; the day book didn't. That is exactly the call the export endpoint makes by
default.

**Date-only input was parsed as a UTC instant.** A picker sends `2026-07-19`;
`new Date("2026-07-19")` is UTC midnight, and the day window was then computed
in *local* time. On this IST machine at 00:40 on the 19th, a day book for
"today" returned **nothing** — the window ran to 18:29 UTC while the entries
were posted at 19:10 UTC. Silent and unexplained: an empty report, no error.

Date-only strings are now built from their parts in local time
(`localDay` in the validators), and the frontend derives "today" with
`toLocalDateInput` rather than `toISOString().slice(0, 10)` — the same bug in the
other direction.

## Verified

62 service-level checks and 55 over authenticated HTTP, against throwaway
databases, using data created through the **Sales and Purchase modules** rather
than hand-posted journals. Trial balance debits === credits; assets ===
liabilities + equity; retained earnings === net profit; day book and drill-down
trace back to their source documents; all eight exports produce valid files. The
generated PDFs were rendered and read, not merely byte-checked.

The Accounting (76) and Sales/POS (66) suites were re-run afterwards. No
regressions.
