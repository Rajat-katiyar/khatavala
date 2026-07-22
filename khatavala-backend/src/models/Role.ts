import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';

/**
 * THE PERMISSION CATALOG
 * ======================
 * Permissions are a *static* list compiled into the application, not rows in a
 * collection. A permission only means something if a route enforces it, so the
 * set of valid permissions is a property of the deployed code — letting an
 * admin invent `sales.approve` in the UI would produce a permission that no
 * handler ever checks, which reads as "granted" to the user and is enforced
 * nowhere.
 *
 * A Role document then stores a plain `string[]` of these keys. Roles are data
 * (per-company, editable); permissions are code.
 *
 * Key format is `module.action`, e.g. `sales.create`, `accounting.view`.
 */
export const PERMISSION_MODULES = {
  sales: {
    label: 'Sales',
    description: 'Invoices, quotations and sales returns',
    actions: ['view', 'create', 'update', 'delete', 'void'],
  },
  purchases: {
    label: 'Purchases',
    description: 'Purchase orders and supplier bills',
    actions: ['view', 'create', 'update', 'delete'],
  },
  inventory: {
    label: 'Inventory',
    description: 'Stock levels, transfers and adjustments',
    actions: ['view', 'create', 'update', 'delete', 'adjust'],
  },
  products: {
    label: 'Products',
    description: 'Item master and pricing',
    actions: ['view', 'create', 'update', 'delete'],
  },
  customers: {
    label: 'Customers',
    description: 'Customer master and receivable ledgers',
    actions: ['view', 'create', 'update', 'delete'],
  },
  suppliers: {
    label: 'Suppliers',
    description: 'Supplier master and payable ledgers',
    actions: ['view', 'create', 'update', 'delete'],
  },
  accounting: {
    label: 'Accounting',
    description: 'Journals, ledgers, payments and reconciliation',
    actions: ['view', 'create', 'update', 'delete', 'close'],
  },
  reports: {
    label: 'Reports',
    description: 'Financial and operational reporting',
    actions: ['view', 'export'],
  },
  users: {
    label: 'Users',
    description: 'Company membership and invitations',
    actions: ['view', 'invite', 'update', 'revoke'],
  },
  roles: {
    label: 'Roles',
    description: 'Custom roles and permission assignment',
    actions: ['view', 'create', 'update', 'delete'],
  },
  settings: {
    label: 'Settings',
    description: 'Company profile and preferences',
    actions: ['view', 'update'],
  },
  audit: {
    label: 'Activity log',
    description: 'Who changed what, and when',
    actions: ['view'],
  },
  expenses: {
    label: 'Expenses',
    description: 'Business expense tracking and recurring schedules',
    actions: ['view', 'create', 'update', 'delete'],
  },
  banking: {
    label: 'Banking',
    description: 'Bank accounts, transactions and statement reconciliation',
    actions: ['view', 'create', 'update', 'delete', 'reconcile'],
  },
} as const;

export type PermissionModule = keyof typeof PERMISSION_MODULES;

/** Every concrete `module.action` key, flattened. */
export const ALL_PERMISSIONS: string[] = Object.entries(PERMISSION_MODULES).flatMap(
  ([module, def]) => def.actions.map((action) => `${module}.${action}`)
);

const PERMISSION_SET = new Set(ALL_PERMISSIONS);

/**
 * Wildcards keep system roles forward-compatible: an Owner holding `*` gains
 * any permission added in a later release without a data migration. Custom
 * roles built in the matrix UI always store concrete keys.
 */
export const isValidPermission = (value: string): boolean => {
  if (value === '*') return true;
  if (value.endsWith('.*')) return value.slice(0, -2) in PERMISSION_MODULES;
  return PERMISSION_SET.has(value);
};

/** Expands `*` / `sales.*` into the concrete keys they cover. */
export function expandPermissions(permissions: string[]): string[] {
  const out = new Set<string>();
  for (const permission of permissions) {
    if (permission === '*') return [...ALL_PERMISSIONS];
    if (permission.endsWith('.*')) {
      const module = permission.slice(0, -2);
      ALL_PERMISSIONS.filter((p) => p.startsWith(`${module}.`)).forEach((p) => out.add(p));
    } else if (PERMISSION_SET.has(permission)) {
      out.add(permission);
    }
    // Unknown keys are dropped rather than thrown on: a permission removed from
    // the catalog in a later release must not lock every role out of loading.
  }
  return [...out];
}

const roleSchema = new Schema(
  {
    // Roles are tenant-scoped rows, including the seeded system ones. Seeding a
    // copy per company (rather than sharing global template documents) means a
    // company can never mutate another's roles, and every role read goes
    // through the same `tenantFilter` discipline as any other collection.
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 240, default: '' },
    permissions: { type: [String], default: [] },

    // System roles are seeded on company creation and cannot be renamed,
    // re-permissioned or deleted — they are the floor the app relies on
    // (an Owner that could revoke `users.invite` from itself is a lockout).
    isSystem: { type: Boolean, default: false },

    // The role an invite defaults to when none is chosen.
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Role names are the human handle inside a company, so they must be unique
// there — two "Cashier" roles would make the users table ambiguous.
roleSchema.index({ companyId: 1, name: 1 }, { unique: true });

export type Role = InferSchemaType<typeof roleSchema>;
export type RoleDocument = HydratedDocument<Role>;
export const RoleModel = model<Role>('Role', roleSchema);

/**
 * Templates for the roles seeded into every new company. The names match the
 * Phase 3 `ROLES` enum on User so that `UserCompanyRole.role` (kept as a
 * denormalized name) and `UserCompanyRole.roleId` always agree.
 */
export interface RoleTemplate {
  name: string;
  description: string;
  permissions: string[];
  isDefault?: boolean;
}

export const SYSTEM_ROLE_TEMPLATES: RoleTemplate[] = [
  {
    name: 'Owner',
    description: 'Full control of the company, including billing and users',
    permissions: ['*'],
  },
  {
    name: 'Manager',
    description: 'Runs day-to-day operations; cannot manage roles or revoke users',
    permissions: [
      'sales.*',
      'purchases.*',
      'inventory.*',
      'products.*',
      'customers.*',
      'suppliers.*',
      'reports.*',
      'accounting.view',
      'users.view',
      'roles.view',
      'settings.view',
      'audit.view',
    ],
  },
  {
    name: 'Cashier',
    description: 'Rings up sales and looks up products; no accounting access',
    permissions: [
      'sales.view',
      'sales.create',
      'products.view',
      'customers.view',
      'customers.create',
      'inventory.view',
    ],
  },
  {
    name: 'Accountant',
    description: 'Books, reconciles and reports; does not touch stock',
    permissions: [
      'accounting.*',
      'reports.*',
      'sales.view',
      'purchases.view',
      'customers.view',
      'suppliers.view',
      'audit.view',
    ],
  },
  {
    name: 'StoreKeeper',
    description: 'Receives and moves stock',
    permissions: [
      'inventory.*',
      'products.view',
      'purchases.view',
      'purchases.create',
      'suppliers.view',
    ],
  },
  {
    name: 'Employee',
    description: 'Read-only access to the basics',
    permissions: ['sales.view', 'products.view', 'customers.view'],
    isDefault: true,
  },
];

