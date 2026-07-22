# Multi-tenancy in Khatavala

**Read this before adding any new collection or module.**

Khatavala is a shared-database, shared-schema multi-tenant app. Every tenant's
data lives in the same MongoDB collections, separated only by a `companyId`
field.

MongoDB has **no row-level security**. There is no database-enforced policy that
stops `InvoiceModel.find({ status: 'unpaid' })` from returning every company's
invoices. Isolation is therefore a *service-layer discipline*, implemented in
one place — [`src/middlewares/tenantScope.ts`](../src/middlewares/tenantScope.ts) —
and applied without exception.

A single query written as `Model.find({ sku })` instead of
`Model.find(tenantFilter(tenant, { sku }))` is a cross-tenant data leak.

---

## The data model

| Collection        | Scope         | Notes                                             |
| ----------------- | ------------- | ------------------------------------------------- |
| `User`            | Global        | One account, many companies                       |
| `Company`         | Registry      | The tenant boundary itself                        |
| `UserCompanyRole` | Registry      | Join table: `(userId, companyId) → role`          |
| `Product`         | **Tenant**    | Reference example — has required `companyId`      |
| *everything else* | **Tenant**    | Customers, invoices, ledgers, payments, …         |

`UserCompanyRole` is why a user can be an **Owner** of Company A and a
**Cashier** of Company B. Authorization inside a company uses that row's role,
**not** `User.role` — `User.role` is only a platform-level default.

`branchId` / `warehouseId` on the membership row narrow a user further within a
company (e.g. a StoreKeeper limited to one warehouse). They are carried through
`TenantContext` and ready for modules that need them.

---

## How the active company is resolved

Two sources, in priority order, both handled by `resolveTenant`:

1. **The `companyId` claim on the access token.** Put there by
   `POST /api/companies/:id/activate`. It is signed by us, so it is trusted
   without a per-request database lookup. Membership was verified when the
   token was minted, and these tokens use a shorter TTL
   (`JWT_ACTIVE_COMPANY_EXPIRES_IN`, default 5m) so a revoked membership stops
   working quickly.
2. **The `X-Company-Id` header.** Client-supplied, therefore **never trusted**:
   membership is verified against `UserCompanyRole` on every single request.

`resolveTenant` does not reject when neither is present — some authenticated
routes legitimately have no tenant (listing your companies, creating your
first one). Routes that need a tenant add `requireTenant`.

---

## The rules

### 1. Every tenant-scoped schema has a required, indexed `companyId`

```ts
companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
```

Uniqueness constraints become **compound**, scoped by company:

```ts
// Right: two tenants may both use SKU "A-100".
productSchema.index({ companyId: 1, sku: 1 }, { unique: true });

// Wrong: rejecting the insert leaks that another tenant owns that SKU.
sku: { type: String, unique: true }
```

### 2. Mount the standard middleware stack

```ts
router.use(authenticate, resolveTenant, requireTenant);
```

All three, in that order. Without `requireTenant`, a request with no active
company reaches the service with `req.tenant` undefined and skips scoping.

### 3. Services take `TenantContext` as their first argument

Required, never optional, never a raw `Request`. An optional `companyId`
parameter is one a caller can forget to pass; a required first argument is not.

```ts
export async function listInvoices(tenant: TenantContext, filter: InvoiceFilter) { … }
```

### 4. Reads use `tenantFilter`, writes use `tenantStamp`

```ts
InvoiceModel.find(tenantFilter(tenant, { status: 'unpaid' }))
InvoiceModel.create(tenantStamp(tenant, input))
```

Both apply `companyId` **last**, so a caller-supplied `companyId` — a bug, or an
injected query parameter — is overwritten rather than honoured.

### 5. Single-document operations filter by `{ _id, companyId }`

```ts
// Right
ProductModel.findOneAndUpdate(tenantById(tenant, id), { $set: input })

// Wrong — a guessed ObjectId mutates another tenant's row
ProductModel.findByIdAndUpdate(id, { $set: input })
```

Return **404, not 403**, for another tenant's document. A 403 confirms the id
exists.

### 6. Aggregations start with a `$match` on `companyId`

```ts
InvoiceModel.aggregate([{ $match: { companyId: tenant.companyId } }, …])
```

`tenantFilter` cannot help inside a pipeline — this one is manual, so check it
in review.

---

## Company switching

```
POST /api/companies/:id/activate
  → verifies membership
  → persists User.activeCompanyId
  → returns a NEW short-lived access token carrying { companyId, companyRole }
```

The **refresh token is not rotated** — switching companies is a scope change,
not a new session. The client swaps its access token and refetches tenant data.

On refresh, `tenantClaimsForUser` re-derives the claims from
`User.activeCompanyId` and **re-verifies membership**, so revoking access takes
effect on the user's next refresh rather than persisting for the life of the
session.

---

## Review checklist for a new module

- [ ] Schema has required, indexed `companyId`
- [ ] Unique indexes are compound with `companyId`
- [ ] Router mounts `authenticate, resolveTenant, requireTenant`
- [ ] Every service function takes `tenant: TenantContext` first
- [ ] Every `find` / `findOne` / `count` wraps its filter in `tenantFilter`
- [ ] Every `create` / `insertMany` wraps its payload in `tenantStamp`
- [ ] Every update / delete filters by `{ _id, companyId }`
- [ ] Every `aggregate` opens with `$match: { companyId }`
- [ ] Cross-tenant access returns 404, not 403

Grep test: search the file for the model name. **Every** call site must pass
through `tenantFilter`, `tenantStamp`, or `tenantById`.
