import { z } from 'zod';

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  roleId: objectId,
});

export const updateUserRoleSchema = z.object({
  roleId: objectId.optional(),
  roleIds: z.array(objectId).min(1).optional(),
});

export const userIdParamSchema = z.object({
  userId: objectId,
});

export const idParamSchema = z.object({
  id: objectId,
});

export const inviteIdParamSchema = z.object({
  inviteId: objectId,
});

// A permission key is `module.action`, or a `module.*` / `*` wildcard. The
// catalog itself is checked in role.service — this only rejects malformed
// strings before they reach the database.
const permissionKey = z
  .string()
  .regex(/^(\*|[a-z]+\.(\*|[a-z]+))$/, 'Permissions look like "sales.create"');

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(240).optional(),
  permissions: z.array(permissionKey).max(200),
});

export const updateRoleSchema = createRoleSchema.partial();

export const duplicateRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(16),
  fullName: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(8).max(128).optional(),
});

export const auditQuerySchema = z.object({
  action: z.string().trim().max(60).optional(),
  entityName: z.string().trim().max(60).optional(),
  userId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type InviteUserInput = z.infer<typeof inviteUserSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
