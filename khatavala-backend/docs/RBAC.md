# RBAC — roles, permissions and the audit trail

Phase 4. Read `TENANCY.md` first: RBAC layers on top of tenancy and does not
replace it. Every rule there still applies.

## The one pattern to follow

Every route in a tenant-scoped module mounts four things, in this order:

```ts
router.use(authenticate, resolveTenant, requireTenant);

router.post('/', requirePermission('sales', 'create'), handler);
```

`requirePermission` is per-route, not per-router, because different actions on
the same resource need different permissions. A router-level permission would
force `sales.view` and `sales.delete` to be the same check.

For a decision that depends on the request body, call the primitive directly:

```ts
if (await checkPermission(req.user, req.tenant, 'sales', 'void')) { … }
```

Inside a service, use `assertPermission` — it throws a 403 `ApiError` instead
of calling `next`.

## Permissions are code; roles are data

`PERMISSION_MODULES` in `models/Role.ts` is the catalog: a static `module →
actions` map compiled into the app. A Role document stores a `string[]` of
those keys.

This split is deliberate. A permission means something only if a route enforces
it, so letting an admin invent `sales.approve` in the UI would produce a
permission granted in the database and checked nowhere — which reads to the
user as "granted" and is enforced by nothing.

**Adding a permission** is therefore a code change: add the action to
`PERMISSION_MODULES`, then add `requirePermission` to the route that needs it.
Both halves, or you have shipped a lie.

Wildcards (`*`, `sales.*`) exist so system roles stay forward-compatible — an
Owner holding `*` gains any new permission without a migration. Custom roles
built in the matrix UI always store concrete keys, and duplicating a role
expands wildcards, so a custom role never silently widens when a module ships.

## Roles are per-company rows, including the built-in ones

Every company gets its own copy of the six system roles, seeded on creation
(`seedSystemRoles`). Sharing global template documents would have been smaller,
but per-company rows mean a company can never mutate another's roles, and every
role read goes through the same `tenantFilter` discipline as any other
collection.

System roles (`isSystem: true`) cannot be edited or deleted. Stripping
`users.invite` from Owner is a one-click, unrecoverable lockout — there is no
platform-level "make me an owner again" path. Duplicate a system role to
customise it.

`assertNotLastOwner` guards the same invariant from the other side: the last
Owner of a company can be neither demoted nor revoked.

## Where authorization state actually lives

**Not in the JWT.** The token carries the active `companyId` and the role
*name* (for display). It does not carry the role id or its permissions.

An earlier revision of this code did carry `roleId`, and it was wrong: a token
is immutable until it expires, so reassigning someone's role did nothing until
the token rotated — and role reassignment is the most common reason an admin
touches permissions at all.

So `checkPermission` resolves the membership fresh on every check, through two
short-TTL process-local caches in `permission.service.ts`:

| Cache        | Key                     | Invalidated by                        |
| ------------ | ----------------------- | ------------------------------------- |
| `membershipCache` | `userId:companyId` | `updateUserRole`, `revokeAccess`, `acceptInvite` |
| `roleCache`  | `roleId`                | `updateRole`, `deleteRole`            |

Two caches rather than one because the two things change independently:
editing a role's permissions and moving a user between roles are different
admin actions.

The membership lookup filters `isActive: true`, which is load-bearing beyond
correctness — it means a revoked user loses every permission on their *next
request*, rather than when their access token expires. Phase 3 could only bound
that window at `JWT_ACTIVE_COMPANY_EXPIRES_IN`; for anything permission-gated,
this closes it.

**Multi-instance caveat:** these are process-local `Map`s. With N instances
behind a load balancer, an instance that did not serve the write keeps serving
stale permissions for up to the 30s TTL. If that ever needs to be zero, move
the caches to Redis (already a dependency) with a pub/sub invalidation channel.

## The audit trail

`withAudit` in `services/audit.service.ts` wraps a service operation and logs
what it did. Use it; do not scatter log-writes through handlers, and do not
reach for Mongoose hooks.

Hooks were considered and rejected — that file documents the full reasoning,
but in short: a hook has no access to the request, so it cannot know *who*
acted; `save` hooks do not fire for `findOneAndUpdate`/`updateOne`/`deleteOne`,
which is most of this service layer; and a post-save hook cannot see the prior
state, so it cannot produce `oldValue`. Auditing is a per-operation policy
decision, which is exactly what a hook cannot express.

Two properties worth knowing:

- **The log is written after the operation succeeds**, so a failed write never
  leaves a row claiming it happened. Conversely an audit failure never rolls
  back a successful business operation — it is best-effort and logs its own
  errors. If a regulated deployment ever needs guaranteed-complete audit, the
  pair has to move into a transaction together.
- **`sanitize` redacts** `passwordHash`, token material and friends. An audit
  log is read by more people than the source table, so it is a real secondary
  exposure point.

`action: 'update'` diffs before/after and stores only the fields that moved.
Storing both full documents would make the activity page unreadable and grow
the collection faster than the data it describes.

There is no write, update or delete endpoint for `AuditLog` anywhere. An audit
trail an admin can edit answers no question worth asking.

## Client-side permissions are UX, not security

`usePermissionStore` and `<Can>` on the frontend hide controls the user would
be denied on anyway. Anyone can edit that state in a console; doing so reveals
buttons that then return 403. The backend check is the only one that counts.

The store is not persisted — a stale permission set restored from localStorage
after a role change would show the wrong UI, and refetching costs one request.

## Migrating an existing database

```
npm run db:init         # collections + indexes for Role, Invite, AuditLog
npm run db:seed-roles   # seed system roles, backfill UserCompanyRole.roleId
```

The second is not optional. `roleId` is required as of Phase 4, and a
membership without one resolves to *no permissions at all* — every pre-existing
user would be silently locked out.
