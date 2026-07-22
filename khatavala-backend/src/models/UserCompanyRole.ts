import { Schema, model, InferSchemaType, HydratedDocument } from 'mongoose';

// Membership join table: one row per (user, company). A user may belong to
// many companies and hold a *different* role in each — which is why the role
// used for authorization is this row's role, not User.role. User.role is only
// the platform-level default (e.g. SuperAdmin).
//
// branchId / warehouseId narrow a membership further: a StoreKeeper scoped to
// one warehouse should not see stock movements from another. Those collections
// do not exist yet, so the refs are declared but unenforced.
const userCompanyRoleSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true,
    },
    // AUTHORIZATION SOURCE OF TRUTH (Phase 4). `roleId` points at a Role
    // document in this company, whose `permissions` array is what
    // `checkPermission` actually enforces.
    roleId: { type: Schema.Types.ObjectId, ref: 'Role', required: true, index: true },
    roleIds: [{ type: Schema.Types.ObjectId, ref: 'Role' }],

    // Denormalized role *name*, kept deliberately.
    role: { type: String, required: true },
    roles: [{ type: String }],

    branchId: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', default: null },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// One membership row per user per company — a second role in the same company
// would make "which role applies?" ambiguous at authorization time.
userCompanyRoleSchema.index({ userId: 1, companyId: 1 }, { unique: true });

export type UserCompanyRole = InferSchemaType<typeof userCompanyRoleSchema>;
export type UserCompanyRoleDocument = HydratedDocument<UserCompanyRole>;
export const UserCompanyRoleModel = model<UserCompanyRole>(
  'UserCompanyRole',
  userCompanyRoleSchema
);
