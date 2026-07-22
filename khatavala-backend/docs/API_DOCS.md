# API reference

Interactive docs at **`/api/docs`**, raw spec at **`/api/docs.json`**.
Locally: <http://localhost:4000/api/docs>

## Generated, not written

Three things a spec normally repeats are instead read off the running app:

| Fact | Source |
| --- | --- |
| Which endpoints exist | the live Express router stack (`docs/routeInventory.ts`) |
| What a request body/query must contain | the `validate()` middleware that will reject it |
| Which permission an endpoint needs | the `requirePermission()` guard that enforces it |

`validate()` and `requirePermission()` stamp their schema and permission onto the
middleware function they return; the router walk reads them back. So the
contract published and the contract enforced are the *same object*, not two
copies that drift.

Consequence worth stating plainly: **a new route cannot be missing from these
docs**, and a deleted one disappears on the next boot. What a generator can't
infer — the prose summary — is hand-written in `SUMMARIES` in `docs/openapi.ts`,
and an endpoint without one still appears with a mechanical summary rather than
vanishing.

## What is deliberately not described

Response bodies are `{ success, data }` with `data` left open. Hand-typing 187
response shapes would recreate exactly the hand-maintained surface this design
removes, and a response schema that has quietly gone stale is worse than an
honest `object`.

## Exposure

On by default outside production, **off by default in production** — the page
enumerates every endpoint and the permission each one needs, which is a useful
map for an attacker and of no use to a customer. `ENABLE_API_DOCS=true` turns it
on in production; that should be a deliberate decision.

helmet's CSP is relaxed (`'unsafe-inline'`) **for `/api/docs` only**, because
Swagger UI ships inline styles and scripts. The rest of the app keeps the strict
policy.

The spec is built once at mount, not per request — it derives from the router,
which cannot change after boot, and rebuilding it per request would hand an
unauthenticated caller a cheap way to burn CPU.

## Using it

1. `POST /api/auth/login`.
2. **Authorize** → paste the `accessToken`.
3. Everything is then callable against your active company. `persistAuthorization`
   is on, so a refresh doesn't log you back out.

## Verified

Booted and checked: 187 operations, matching the router inventory exactly — 131
paths, 18 tags, 70 with request bodies, 34 with query parameters. The 9
unauthenticated endpoints are the pre-login surface only (register, login,
refresh, logout, forgot/reset password, invites, health); the 8 authenticated
but ungated ones are the pre-company-selection surface, where a company-scoped
permission cannot yet be evaluated. Swagger UI and all its assets load under the
scoped CSP.
